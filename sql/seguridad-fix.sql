-- ============================================================================
-- seguridad-fix.sql  —  Remediación de hallazgos de Supabase advisors (MBLE-INT)
-- Generado: jun-2026.  Proyecto: xhfeurinovvsbgobkidy
--
-- COMO USAR:
--   1. Leer cada bloque. La PARTE A es segura para el maderable y se puede correr ya.
--   2. La PARTE B toca tablas/funciones de OTRAS apps que comparten esta base.
--      Está COMENTADA a propósito. Descomentá cada fix SOLO después de confirmar
--      que la app dueña no depende del acceso anónimo que vas a sacar.
--   3. Correr en el SQL Editor de Supabase. Revisar el resultado de cada statement.
--
-- CONTEXTO: el backend del maderable usa el SERVICE ROLE KEY (ignora RLS), así que
-- nada de esto rompe la app maderable. El riesgo es romper las apps vecinas.
-- ============================================================================


-- ============================================================================
-- PARTE A — SEGURO PARA EL MADERABLE (se puede correr ya)
-- ============================================================================

-- A1. Hardening de search_path en nextval_envio (usado por tiempos.js:2940).
--     Sin search_path fijo, un atacante con control de roles podría inyectar
--     funciones. Fijarlo es hardening puro, no cambia el comportamiento.
ALTER FUNCTION public.nextval_envio() SET search_path = pg_catalog, public, pg_temp;


-- ============================================================================
-- PARTE B — TOCA OTRAS APPS (compartidas en MBLE-INT). NO correr a ciegas.
--   Descomentá cada bloque SOLO tras verificar la app dueña.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1. [CRÍTICO] verificar_operario(legajo, pin) — SECURITY DEFINER ejecutable
--     por anon vía /rest/v1/rpc/. Permite fuerza bruta de PINs sin límite.
--     DUEÑO PROBABLE: kiosco/app de fichaje de operarios que llama la RPC con
--     el anon key. Si ese kiosco la usa directo, REVOCAR la rompe.
--     FIX CORRECTO: enrutar la verificación por un endpoint backend con rate
--     limiting y LUEGO revocar. Mientras tanto, al menos quitar acceso anon:
--
-- REVOKE EXECUTE ON FUNCTION public.verificar_operario(text, text) FROM anon;
-- REVOKE EXECUTE ON FUNCTION public.verificar_operario(text, text) FROM authenticated;

-- ----------------------------------------------------------------------------
-- B2. registrar_retiro_atomico(...) — SECURITY DEFINER ejecutable por anon.
--     DUEÑO: app de control de herramientas (herramientas/trabajadores/movimientos).
--     Permite registrar retiros de herramientas sin autenticación.
--
-- REVOKE EXECUTE ON FUNCTION public.registrar_retiro_atomico(integer[], integer, text) FROM anon;
-- REVOKE EXECUTE ON FUNCTION public.registrar_retiro_atomico(integer[], integer, text) FROM authenticated;

-- ----------------------------------------------------------------------------
-- B3. jornales_* — policies anon_all_* (USING true / WITH CHECK true) = lectura
--     y escritura ANÓNIMA total sobre datos de jornales.
--     DUEÑO: app de jornales. Si esa app usa el anon key directo, dropear esto
--     la deja sin acceso. Reemplazar por policies reales o mover a service key.
--
-- DROP POLICY IF EXISTS anon_all_personas  ON public.jornales_personas;
-- DROP POLICY IF EXISTS anon_all_proyectos ON public.jornales_proyectos;
-- DROP POLICY IF EXISTS anon_all_registros ON public.jornales_registros;
-- DROP POLICY IF EXISTS anon_all_tarifas   ON public.jornales_tarifas;

-- ----------------------------------------------------------------------------
-- B4. movimientos / herramientas / trabajadores — policies permisivas
--     (UPDATE/INSERT con true). DUEÑO: app de control de herramientas.
--
-- DROP POLICY IF EXISTS movimientos_update    ON public.movimientos;
-- DROP POLICY IF EXISTS herramientas_insert    ON public.herramientas;
-- DROP POLICY IF EXISTS herramientas_update    ON public.herramientas;
-- DROP POLICY IF EXISTS trabajadores_insert    ON public.trabajadores;
-- DROP POLICY IF EXISTS trabajadores_update    ON public.trabajadores;

-- ----------------------------------------------------------------------------
-- B5. Bucket de storage `uploads` — público y listable: cualquiera enumera todos
--     los archivos. DUEÑO: app que sube a `uploads` (NO es el maderable; el
--     maderable usa el bucket privado `backups`).
--     Opción a) quitar la policy de listado amplia:
--
-- DROP POLICY IF EXISTS "uploads_select" ON storage.objects;
-- DROP POLICY IF EXISTS "allow anon update 1va6avm_1" ON storage.objects;
--
--     Opción b) marcar el bucket como privado (requiere ajustar cómo la app dueña
--     genera las URLs — usar signed URLs):
-- UPDATE storage.buckets SET public = false WHERE id = 'uploads';

-- ----------------------------------------------------------------------------
-- B6. [ERROR] Vista corte.cortes_listado — SECURITY DEFINER: corre con permisos
--     del creador, no del que consulta. DUEÑO: app de cortes/placas.
--     Recrear como SECURITY INVOKER (Postgres 15+):
--
-- ALTER VIEW corte.cortes_listado SET (security_invoker = on);

-- ----------------------------------------------------------------------------
-- B7. Hardening search_path en corte.set_updated_at (trigger fn, app de cortes):
--
-- ALTER FUNCTION corte.set_updated_at() SET search_path = pg_catalog, public, pg_temp;


-- ============================================================================
-- FUERA DE SQL (hacer desde el Dashboard / código):
--   - Auth > Leaked Password Protection: activar (HaveIBeenPwned).
--   - js/supabase-config.js: borrar la línea SUPABASE_ANON_KEY (definida sin uso).
--   - App-level: PINs → bcrypt; rate limiting en login-admin/verificar-pin;
--     AUTH.checkSession debe fallar CERRADO (hoy devuelve true ante error de red).
-- ============================================================================
