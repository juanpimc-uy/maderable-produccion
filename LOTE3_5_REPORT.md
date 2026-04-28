# Lote 3.5 — Fix login planta2

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `api/tiempos.js` | Nuevo endpoint `POST /api/tiempos?action=verificar-pin`: recibe `{ cedula, pin }`, compara contra Supabase server-side, devuelve el objeto empleado **sin PIN** |
| `planta2.html` | Login ahora llama a `verificar-pin`. Eliminadas las referencias a `opt.dataset.pin` y `empleadoActual.pin`. El dropdown guarda `cedula` en lugar de `pin` |

**PIN no se descarga al cliente en ningún momento** — ni en el GET empleados (removido en Lote 2), ni como resultado del login.

---

## Cómo probar

1. Abrir `/planta2.html` en un dispositivo (tablet de planta o Chrome DevTools)
2. Seleccionar un operario activo del dropdown
3. Ingresar los 4 dígitos del PIN correcto → debe entrar normalmente
4. Probar con PIN incorrecto → animación shake + mensaje "Cédula o PIN incorrectos"
5. Probar con un empleado sin cédula registrada → "Empleado sin cédula registrada"
6. En DevTools Network: verificar que la request va a `POST /api/tiempos?action=verificar-pin` y que la respuesta **no contiene el campo `pin`**
7. Verificar que el endpoint `GET /api/tiempos?action=empleados` tampoco contiene `pin` en ningún objeto

---

## Lotes que esto destraba

- **Lote 4 (tiempos para oficina):** puede reutilizar el mismo patrón `verificar-pin` si necesita un flujo de login alternativo
- **Lote 5 (Tiempos completo):** la planta ya funciona correctamente, sin blocker de login

---

## Deudas técnicas que NO se tocaron

| Deuda | Lote objetivo |
|-------|---------------|
| RLS Supabase — policies row-level en todas las tablas | Lote 1 (pendiente) |
| Renombrar `proyectos_cache` → `proyectos` | Lote 1 (pendiente) |
| PINs en plain text — migrar a bcrypt | Post Lote 1 (requiere RLS primero) |
| Rate limiting en `login-admin` y `verificar-pin` | Hardening futuro |
