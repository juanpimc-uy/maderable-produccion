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
