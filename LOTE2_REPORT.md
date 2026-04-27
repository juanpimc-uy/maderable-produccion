# LOTE 2 — Auth + Roles · Reporte de implementación

## Resumen

Sistema de autenticación por email + PIN para el panel de administración (`admin.html`), con control de acceso basado en roles (`rol_app`).

---

## Cambios por paso

### PASO 1 — SQL schema
**Archivo:** `sql/lote2-auth-roles.sql`

- `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS email TEXT`
- `ALTER TABLE empleados ADD COLUMN IF NOT EXISTS rol_app TEXT DEFAULT 'operario'`
- Constraint: `rol_app IN ('operario', 'oficina', 'admin')`
- Índice único parcial en `email` (cuando no es NULL)
- Seeds: Juan Martinez → admin, Laura Gómez → oficina

> **Pendiente:** Ejecutar este script en el SQL Editor de Supabase.

---

### PASO 2 — Endpoints API
**Archivo:** `api/tiempos.js`

| Endpoint | Método | Descripción |
|---|---|---|
| `login-admin` | POST | Valida email + PIN; retorna usuario o 401/403 |
| `cambiar-pin` | POST | Verifica PIN actual, valida formato 4 dígitos, actualiza |
| `resetear-pin` | POST | Admin/oficina resetea PIN de otro empleado a `1234` |

---

### PASO 3 — Módulo auth
**Archivo:** `js/auth.js`

`window.AUTH` con métodos: `guardarSesion`, `usuarioActual`, `cerrarSesion`, `esAdmin`, `esOficina`, `puedeEntrarAAdmin`, `requireAdmin`.

---

### PASO 4 — Login overlay en admin.html

- Overlay de pantalla completa (`#login-overlay`) oculta el shell hasta autenticar
- `_loginSubmit()` POST a `login-admin` → `AUTH.guardarSesion()` → reload
- Auth gate IIFE al inicio del script; lanza excepción si no hay sesión

---

### PASO 5 — Pestaña "Mi cuenta"

- Nueva vista `v-mi-cuenta` en sidebar
- Muestra nombre, email, rol y categoría del usuario autenticado (solo lectura)
- Formulario para cambiar PIN propio (validación local + llamada a `cambiar-pin`)

---

### PASO 6 — Resetear PIN ajeno (pestaña Operarios)

- Botón `↻ PIN` en cada fila de la tabla de operarios
- `resetearPinOperario(opId, nombre)`: confirm → POST a `resetear-pin` → alert resultado

---

### PASO 7 — Ocultar campo Categoría para roles no-admin

- En el modal de edición de operario, el `<select>` de Categoría solo se renderiza si `window.AUTH.esAdmin()`
- En `guardarOperario()`, si el select no existe (oficina), se conserva la categoría preexistente del operario

---

### PASO 8 — Fix timer CNC en re-login (planta2.html)

**Problema:** Al re-ingresar, si Supabase no devolvía placa activa o fallaba la llamada, los keys `cnc_placa_inicio` / `cnc_placa_numero` del localStorage quedaban con datos de la sesión anterior, mostrando un timer incorrecto.

**Fix:** En ambos branches negativos (`placa?.inicio` falsy y bloque `catch`), se llama a `localStorage.removeItem('cnc_placa_inicio')` y `localStorage.removeItem('cnc_placa_numero')`.

---

## SQL pendiente de ejecutar en Supabase

```sql
-- Desde sql/lote2-auth-roles.sql
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS rol_app TEXT DEFAULT 'operario';
ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_rol_app_check;
ALTER TABLE empleados ADD CONSTRAINT empleados_rol_app_check
  CHECK (rol_app IN ('operario', 'oficina', 'admin'));
DROP INDEX IF EXISTS idx_empleados_email_unique;
CREATE UNIQUE INDEX idx_empleados_email_unique ON empleados (email) WHERE email IS NOT NULL;
UPDATE empleados SET cedula='9.999.999-9', email='juan@maderable.uy', categoria='administrativo', rol_app='admin', pin='1234' WHERE nombre='Juan Martinez';
UPDATE empleados SET email='laura@maderable.uy', rol_app='oficina' WHERE nombre='Laura Gómez';
```

---

## Smoke tests

- [ ] Login con email `juan@maderable.uy` + PIN `1234` → accede como admin
- [ ] Login con email `laura@maderable.uy` + PIN correcto → accede como oficina
- [ ] Login con PIN incorrecto → mensaje de error, sin acceso
- [ ] Operario intenta login en admin.html → redirige a planta2.html
- [ ] Admin ve campo Categoría en modal de operario; oficina no lo ve
- [ ] Admin resetea PIN de operario → confirmación visible en tabla
- [ ] Usuario cambia su propio PIN → campos se limpian tras éxito
- [ ] Cerrar sesión → overlay reaparece
- [ ] Re-login en planta2 con CNC activo y placa en Supabase → timer correcto
- [ ] Re-login en planta2 con CNC activo pero sin placa en Supabase → sin timer fantasma

---

## Deuda técnica conocida

| Item | Detalle |
|---|---|
| PIN en texto plano | Los PINs se almacenan como texto en la columna `pin`. Migrar a hash (bcrypt/argon2) en el servidor antes de producción real. |
| Sin rate limiting | El endpoint `login-admin` no tiene throttling. Cualquier atacante puede hacer fuerza bruta de PINs de 4 dígitos (10.000 combinaciones). |
| sessionStorage | La sesión se pierde al cerrar la pestaña. Considerar `localStorage` + refresh token si se requiere persistencia. |
| Anon key expuesta | `SUPABASE_ANON_KEY` está en el frontend. Aceptable con RLS bien configurado, pero RLS no fue revisado en este lote. |
