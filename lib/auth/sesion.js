// lib/auth/sesion.js — Verificación de sesión para pantallas de planta y oficina.
// Recibe el cliente de Supabase como parámetro para no acoplarse a ningún endpoint.

/**
 * Verifica la sesión del header Authorization: Bearer.
 * Válida si el empleado existe, está activo, no archivado y el token no venció.
 * Devuelve { id, nombre, rol_app } o null. Sin filtrar por rol.
 */
export async function verificarSesionPlanta(supabase, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return null;
  // 1) Buscar en tabla `sesiones` (multi-dispositivo)
  const s = await buscarSesion(supabase, token);
  if (s) {
    const { data: emp } = await supabase
      .from('empleados')
      .select('id, nombre, rol_app')
      .eq('id', s.empleado_id)
      .eq('activo', true)
      .eq('archivado', false)
      .maybeSingle();
    return emp || null;
  }
  // 2) Fallback: columna session_token en empleados (migración gradual)
  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, rol_app')
    .eq('session_token', token)
    .gt('session_expires_at', new Date().toISOString())
    .eq('activo', true)
    .eq('archivado', false)
    .maybeSingle();
  return data || null;
}

/**
 * Devuelve true si el rol es admin u oficina.
 */
export function esOficina(sesion) {
  return sesion && (sesion.rol_app === 'admin' || sesion.rol_app === 'oficina');
}

// ── Sesiones multi-dispositivo (tabla `sesiones`) ───────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea una fila en `sesiones`. Limpia sesiones expiradas del empleado al pasar.
 * Devuelve { token, expira_at }.
 */
export async function crearSesion(supabase, { empleado_id, contexto, minutos, userAgent }) {
  // Limpieza: borrar sesiones expiradas hace más de 7 días
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('sesiones')
    .delete()
    .eq('empleado_id', empleado_id)
    .lt('expira_at', hace7d);

  const token = crypto.randomUUID();
  const ahora = new Date();
  const expira_at = new Date(ahora.getTime() + minutos * 60 * 1000).toISOString();
  const { error } = await supabase.from('sesiones').insert({
    token,
    empleado_id,
    contexto,
    dispositivo: (userAgent || '').slice(0, 200),
    creado_en: ahora.toISOString(),
    ultimo_uso: ahora.toISOString(),
    expira_at,
  });
  if (error) throw error;
  return { token, expira_at };
}

/**
 * Busca una sesión vigente por token. Devuelve la fila o null.
 */
export async function buscarSesion(supabase, token) {
  if (!token || !UUID_RE.test(token)) return null;
  const { data } = await supabase.from('sesiones')
    .select('token, empleado_id, contexto, ultimo_uso, expira_at')
    .eq('token', token)
    .gt('expira_at', new Date().toISOString())
    .maybeSingle();
  return data || null;
}

/**
 * Renovación deslizante con throttle de 1 hora (solo contexto 'oficina').
 */
export async function tocarSesion(supabase, sesion) {
  if (sesion.contexto !== 'oficina') return;
  if (new Date(sesion.ultimo_uso).getTime() >= Date.now() - 3600000) return; // throttle
  const ahora = new Date();
  const expira_at = new Date(ahora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('sesiones')
    .update({ ultimo_uso: ahora.toISOString(), expira_at })
    .eq('token', sesion.token);
}
