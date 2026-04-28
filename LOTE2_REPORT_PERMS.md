# LOTE 2 — Permisos y Gating · Reporte

## Matriz de permisos implementada

| Acción                                  | operario | oficina | admin |
|-----------------------------------------|:--------:|:-------:|:-----:|
| Login en planta2.html (cédula+PIN)      | ✓        | ✓       | ✓     |
| Login en admin.html (email+PIN)         | ✗        | ✓       | ✓     |
| Ver lista de operarios                  | ✗        | ✓       | ✓     |
| Ver categoría de OTROS operarios        | ✗        | ✗       | ✓     |
| Ver su propia categoría (Mi cuenta)     | ✓        | ✓       | ✓     |
| Editar centros habilitados de operario  | ✗        | ✓       | ✓     |
| Editar nombre/cédula/email/avatar       | ✗        | ✗       | ✓     |
| Editar rol_app de cualquier empleado    | ✗        | ✗       | ✓     |
| Editar categoría de cualquier empleado  | ✗        | ✗       | ✓     |
| Resetear PIN ajeno                      | ✗        | ✓       | ✓     |
| Cambiar su propio PIN (Mi cuenta)       | ✓        | ✓       | ✓     |
| Crear nuevo empleado                    | ✗        | ✗       | ✓     |
| Eliminar empleado                       | ✗        | ✗       | ✓     |

---

## Cambios por archivo

### admin.html

**FIX 1 — Inputs PIN no se vacían (ya existía en sesión anterior)**
- `renderMiCuenta()` guarda con early-return si `#mi-cuenta-contenido` ya tiene contenido.
- Previene que el auto-refresh (60 s) destruya los `<input>` mientras el usuario escribe.

**FIX 2 — Categoría oculta para no-admin en lista de Operarios**
- En `_renderOpGestion()`, la categoría del operario se muestra en el subtítulo de cada fila solo cuando `window.AUTH.esAdmin()` es verdadero.
- Oficina ve: `rol_app · N sesiones · Xh`.
- Admin ve: `rol_app · categoría (amber) · N sesiones · Xh`.

**FIX 3 — Modal Editar Operario: gating por rol**
- `abrirModalOperario()` redirige a `/planta2.html` si el rol es `operario`.
- Para `oficina`: todos los campos (nombre, cédula, avatar, email, rol, categoría) se renderizan con `disabled` + `opacity:0.55`. Solo los checkboxes de centros son interactivos.
- Texto informativo visible para oficina: "Solo podés editar centros habilitados. Para cambiar otros datos, pedile a un admin."
- `guardarOperario()`: si `esOficina()`, solo actualiza `op.centros` localmente y llama a `syncEmpleadoSupabase` (que el backend filtra a solo centros). Retorna sin leer otros campos.
- `guardarOperario()`: si `operario`, redirige a planta2.

**FIX 4 — Botones create/delete/reset por rol**
- `+ Nuevo Operario`: solo renderizado si `esAdmin()`.
- `↑ Sincronizar todos`: solo renderizado si `esAdmin()`.
- `🗑` (eliminar): solo renderizado si `esAdmin()`.
- `↻ PIN` (resetear): renderizado si `esAdmin() || esOficina()`.
- Botón de editar (engranaje): siempre visible para admin y oficina.

**FIX 5 — Frontend pasa `admin_id`**
- `syncEmpleadoSupabase()`, `syncOperarioSupabase()`, `syncTodosOperarios()`: todos incluyen `admin_id: window.AUTH.usuarioActual()?.id` en el body del fetch.
- `eliminarOperario()` ahora es `async`; primero llama `POST /api/tiempos?action=eliminar-empleado` con `{ admin_id, empleado_id }`. Si el API responde con error, aborta sin tocar el estado local.

---

### api/tiempos.js

**FIX 5 — Permisos backend en sync-empleado / crear-empleado**
- Se requiere `admin_id` en el body (400 si falta).
- Se hace SELECT de `rol_app` del `admin_id` en Supabase.
- `operario`: 403 siempre.
- `oficina`: solo puede hacer UPDATE de `centros_autorizados`. Si el empleado no existe (INSERT), 403.
- `admin`: UPDATE o INSERT completo con todos los campos.

**FIX 5 — Nuevo endpoint `eliminar-empleado`**
- `POST /api/tiempos?action=eliminar-empleado`
- Body: `{ admin_id, empleado_id }`
- Verifica que `admin_id.rol_app === 'admin'`. Si no: 403.
- Soft-delete: `UPDATE empleados SET activo = false WHERE id = empleado_id`.
- El empleado desaparece del GET `empleados` (que filtra `activo = true`) en el próximo refresh.

**Sin cambios**
- `cambiar-pin`: cualquier usuario autenticado puede cambiar su propio PIN (ya valida pin_actual).
- `resetear-pin`: ya verifica que `admin_id.rol_app IN ('admin', 'oficina')`.
- `login-admin`: sin cambios.

---

## Smoke tests recomendados

- [ ] **Admin (Juan):** login en admin.html → accede. Ve categoría en lista de operarios. Modal editar totalmente editable. Puede crear y eliminar operarios.
- [ ] **Oficina (Laura):** login en admin.html → accede. NO ve categoría en lista. Al abrir editar operario, todos los campos excepto centros aparecen grises y no editables. Mensaje informativo visible.
- [ ] **Oficina:** NO ve botón `+ Nuevo Operario` ni `🗑` papelera. SÍ ve `↻ PIN`.
- [ ] **Oficina:** guardar cambio de centros → persiste. Categoría del operario no cambia.
- [ ] **Oficina (manual API):** `POST /api/tiempos?action=sync-empleado` con `{ admin_id: <laura_id>, nombre: '...', rol_app: 'admin' }` → el servidor ignora `rol_app` y solo actualiza centros.
- [ ] **Oficina (manual API):** mismo POST con empleado inexistente → 403 "Solo admin puede crear empleados".
- [ ] **Admin:** eliminar operario sin sesiones activas → se llama API, se marca `activo=false` en Supabase, desaparece del siguiente refresh.
- [ ] **Admin:** eliminar operario con sesión activa → bloqueado client-side con alert.
- [ ] **Cambiar PIN propio:** todos los roles → funciona sin que los inputs se vacíen.
