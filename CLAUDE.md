# CLAUDE.md — Reglas de trabajo para MBLE ERP (maderable-produccion)

## Regla absoluta de Git
- PROHIBIDO ejecutar `git add`, `git commit` o `git push` sin un **"ok push"** explícito de JP.
- Implementar, pegar el código literal para auditar, y **parar**.
- Al pushear, stagear SOLO los archivos que JP indique. No empaquetar archivos no mencionados.
- Mensajes de commit en español, concisos, con prefijo (feat/fix/refactor).

## SQL
- NO ejecutar SQL contra Supabase. Dejar archivos `.sql` en `/sql/` para que JP los corra a mano.

## Arquitectura del proyecto
- **Runtime**: `api/tiempos.js` y `api/armados.js` son Edge runtime. `api/informes.js` es Node.js runtime.
- **Auth edge** (tiempos/armados): `verificarSesion(token)` — session_token de empleados.
- **Auth informes**: `verificarAccesoSeccion(req)` (PIN sección) o `verificarSesionAdminOficina(req)` (session_token admin/oficina).
- **Auth interna** (server-to-server): header `x-internal-secret` vs `process.env.INTERNAL_SECRET`.
- **Zoho**: token cacheado via `getZohoToken()` de `api/_zoho-token-cache.js` (compartido).
- **ok()/err()**: en tiempos.js NO inyecta `ok:true` (pasar explícito). En informes.js SÍ inyecta `ok:true`.
- **Supabase**: cada archivo instancia su propio `createClient()`. Limit default 1000 filas — paginar si se necesitan más.

## Convenciones de código
- HTML monolítico (admin.html, planta2.html, informes.html, planta-publica.html) con JS inline.
- CSS inline en los HTML, no hay framework CSS.
- Verificar syntax con `node -c` (backend) o `new Function()` (HTML scripts) antes de entregar.
- No agregar features, docstrings ni refactors no pedidos.
- No crear archivos nuevos salvo que sea explícitamente necesario.

## Estructura de datos clave
- `proyectos_cache`: tabla principal de proyectos. Columna `muebles` es JSONB array. `activo` boolean para archivar.
- `registros_trabajo`: horas fichadas. `item_id` es local por proyecto (mf_0, mf_1...) — clave compuesta con `proyecto_id`.
- `items_completado_log`: ledger de completado/reabierto por mueble. Ordenar por `creado_at` DESC (no `completado_en`).
- `despachos_muebles`: exit signal de ctrl-despachos. Clave `(proyecto_id, mf_n, unidad)`.
- `precios_muebles`: precio de venta por mueble desde Zoho. Clave `(proyecto_id, mf_n)`.

## Flujo de completado
- `marcar-item` (tiempos.js): registra completado/reabierto en `items_completado_log`, recalcula estado ODF.
- Guard en `_iniciarTareaImpl`: bloquea fichar horas sobre mueble completado vigente (debe reabrir primero).
- `_inyectarCompletado`: inyecta `completado`/`completado_en` en el JSONB muebles al leer proyectos.

## Lean / Carga por etapa
- Clasificación centralizada en `clasificarMueble()` (informes.js) — una sola función, no duplicar.
- Precedencia: fuera > completado > colocacion > shop_drawing > armado > centro directo > sin_registro_propio.
- Clave de muebleLast: `proyecto_id + '|' + item_id` (compuesta, no solo item_id).

## Estado de arquitectura y roadmap
Fuente de verdad del roadmap/backlog: `ARQUITECTURA.md` (cuando exista).
Los `LOTE*_REPORT.md` de la raíz son históricos y están desactualizados — no
fiarse de ellos para saber qué falta.

Diagnóstico (jun-2026): prototipo exitoso que superó su estructura.
`tiempos.js` = 5.133 líneas / 114 actions en un `if/else` (god function).
Plan: estrategia *strangler* — extraer dominios de `tiempos.js` a una capa
`/lib` (modelos + reglas de negocio testeables), un dominio por vez.
**Regla**: no agregar al monolito; solo extraer. Features nuevas nacen en `/lib`.
No crear más pares `-v2` (ya hay legacy: `entrada`/`entrada-v2`, etc.) — consolidar.

### Bugs bloqueantes (integridad de datos — antes que features)
- `jornada_segmentos`: `_entradaImpl` pisa la entrada de la mañana al re-entrar (24+ jornadas afectadas).
- `cron-cierre.js` fabrica `fin = 18:00` (viola "no fabricar datos").
- `Operarios > Estado Real` muestra "undefined undefined" en CENTRO.

### Deudas técnicas priorizadas
- **Seguridad** (verificado con Supabase advisors, jun-2026 — corrige el mito "RLS off"):
  - RLS está **activado** en las 41 tablas de `public`. El backend funciona con el
    **service role key** (ignora RLS); el frontend pasa todo por `/api`. El anon key
    de `js/supabase-config.js` está **definido pero sin uso** (se puede borrar).
  - El core del maderable está OK. Los agujeros reales son de **apps vecinas que
    comparten la base MBLE-INT**: `verificar_operario` (RPC SECURITY DEFINER anónima =
    brute-force de PIN), `registrar_retiro_atomico`, policies `anon_all_*` en
    `jornales_*`, escritura anónima en `movimientos`/`herramientas`/`trabajadores`,
    bucket `uploads` público y listable, vista `corte.cortes_listado` SECURITY DEFINER.
  - Decisión de arquitectura pendiente: **separar apps en proyectos Supabase distintos**
    vs. gobernar el esquema compartido. Ver `/sql/seguridad-fix.sql`.
  - App-level (siguen válidas): PINs en texto plano (→ bcrypt); sin rate limiting en
    `login-admin`/`verificar-pin`; `AUTH.checkSession` falla *abierto*.
- **Datos**: migration runner + schema source-of-truth (hoy 45 `.sql` a mano);
  renombrar `proyectos_cache`→`proyectos`; unificar `cliente`/`cliente_nombre` e `items`/`muebles`.
- **Tests**: no hay. Empezar por cálculo de horas/costos.

### Regla de datos
No fabricar datos para "rellenar" (ej. `fin = 18:00`): si no existe, queda null y
se marca pendiente. Cambios de schema → siempre con backfill verificable.
