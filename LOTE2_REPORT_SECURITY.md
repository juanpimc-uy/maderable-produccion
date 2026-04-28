# LOTE 2 — Security Report: Privilege Escalation Fix

## Descripción del agujero

**Vector:** Un usuario con `rol_app=oficina` podía llamar al endpoint `resetear-pin` pasando como `empleado_id` el id de un usuario con `rol_app=admin`. El backend solo verificaba que el caller fuera `admin` o `oficina`, sin comparar el rol del target. Resultado: Laura (oficina) podía resetear el PIN de Juan (admin) a `1234`, luego loguearse en admin.html con las credenciales de Juan, y obtener privilegios de administrador completo.

**Escalada completa en 3 pasos:**
1. `POST /api/tiempos?action=resetear-pin` con `{ admin_id: laura_id, empleado_id: juan_id }` → 200 OK
2. `POST /api/tiempos?action=login-admin` con `{ email: 'juan@maderable.uy', pin: '1234' }` → sesión de admin
3. Acceso total: crear empleados, eliminar operarios, cambiar roles, ver emails.

**Problema secundario (self-reset):** no había restricción para resetear el propio PIN vía este endpoint, lo que creaba confusión con el flujo de "Mi cuenta".

---

## Cambios por archivo

### api/tiempos.js

**`resetear-pin`**
- Agrega chequeo de auto-reset: si `admin_id === empleado_id` → 400 "Para cambiar tu propio PIN usá la sección Mi cuenta".
- Carga actor y target en **paralelo** (`Promise.all`) para reducir latencia.
- Evalúa jerarquía con regla explícita:
  - `admin` → puede resetear a cualquiera
  - `oficina` + target `operario` → puede resetear
  - Cualquier otro caso → 403 "No tenés permisos para resetear el PIN de este usuario"

**`sync-empleado` / `crear-empleado` (UPDATE path)**
- Cambia `SELECT id` por `SELECT id, rol_app` al buscar el empleado existente.
- Si caller es `oficina` y `existing.rol_app !== 'operario'` → 403 antes de tocar ningún campo.
- Esto bloquea que oficina actualice centros (o cualquier otro campo) de otro oficina o admin.

**`eliminar-empleado`**
- Agrega chequeo de auto-delete: si `admin_id === empleado_id` → 400 "No podés eliminarte a vos mismo".

---

### admin.html

**`resetearPinOperario()`**
- Agrega pre-check client-side: si el usuario es `oficina` y el target no es `operario` → `alert('No permitido...')` y return sin llamar al backend.

**`abrirModalOperario()`**
- Agrega pre-check: si el usuario es `oficina` y el target no es `operario` → `alert('No permitido...')` y return.

**`_renderOpGestion()`**
- Calcula `_meId = window.AUTH.usuarioActual()?.id` al inicio de la función.
- El botón `↻ PIN` solo se renderiza si `op.id !== _meId` (propio usuario nunca ve el botón en su fila).

---

## Smoke tests recomendados

### Privilege escalation (el agujero principal)

- [ ] **Login como Laura → click "↻ PIN" en fila de Juan (admin):**
  debe mostrar alert "No permitido. Solo un admin puede resetear el PIN de un oficina o admin." Sin request al servidor.

- [ ] **Login como Laura → click "↻ PIN" en fila de otro oficina:**
  mismo alert, sin request.

- [ ] **Login como Laura → click "↻ PIN" en fila de un operario:**
  debe funcionar normalmente (confirm → reset → ✓ alert).

- [ ] **curl directo (bypass frontend) con admin_id=Laura, empleado_id=Juan:**
  ```bash
  curl -X POST '/api/tiempos?action=resetear-pin' \
    -H 'Content-Type: application/json' \
    -d '{"admin_id":"<laura_id>","empleado_id":"<juan_id>"}'
  ```
  Debe retornar 403 `{ ok: false, error: "No tenés permisos para resetear el PIN de este usuario" }`.

- [ ] **curl con admin_id=Juan, empleado_id=Laura:**
  Debe retornar 200 y resetear el PIN (admin puede resetear a oficina).

- [ ] **curl con admin_id=Laura, sync-empleado con empleado oficina o admin como target:**
  Debe retornar 403 `{ ok: false, error: "No tenés permisos para modificar este usuario" }`.

### Self-protection

- [ ] **Login como Juan → su propia fila NO tiene botón "↻ PIN".**

- [ ] **curl con admin_id=Juan, empleado_id=Juan en resetear-pin:**
  Debe retornar 400 "Para cambiar tu propio PIN usá la sección Mi cuenta".

- [ ] **curl con admin_id=Juan, empleado_id=Juan en eliminar-empleado:**
  Debe retornar 400 "No podés eliminarte a vos mismo".

### Regresión — flujos válidos

- [ ] **Laura edita centros de un operario:** funciona.
- [ ] **Juan edita cualquier empleado:** funciona.
- [ ] **Juan elimina un operario:** funciona.
- [ ] **Cambiar propio PIN desde "Mi cuenta":** funciona para todos los roles.
