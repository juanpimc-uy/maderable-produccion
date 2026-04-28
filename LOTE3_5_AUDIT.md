# Lote 3.5 — Auditoría: referencias a `pin` en el cliente

Búsqueda global de `e.pin`, `empleado.pin`, `.pin ===`, `opt.dataset.pin` y
`select.*pin` en todos los archivos del repo. Estado al cierre del lote 3.5.

---

## planta2.html

**Ninguna ocurrencia.** Las tres referencias que existían fueron eliminadas en este lote:

| Línea (anterior) | Código | Acción |
|-----------------|--------|--------|
| ~1023 | `opt.dataset.pin = e.pin;` | Eliminado. Reemplazado por `opt.dataset.cedula = e.cedula` |
| ~1056 | `if (String(opt.dataset.pin) !== _pin)` | Eliminado. Reemplazado por llamada a `verificar-pin` |
| ~1075 | `pin: opt.dataset.pin,` dentro de `empleadoActual` | Eliminado. `empleadoActual` ya no tiene campo `pin` |

---

## admin.html

Las referencias en admin.html son **todas legítimas y correctas** — corresponden
a flujos server-side que nunca exponen el PIN al DOM:

| Línea | Código | Evaluación |
|-------|--------|------------|
| 154, 158 | `<input id="login-pin">` | Input de login admin (email+PIN) → pasa al endpoint `login-admin`. PIN no se almacena en DOM. ✓ |
| 338, 342, 348 | `const pin = document.getElementById('login-pin').value` | Leído del input, enviado a `login-admin`, descartado. ✓ |
| 3090–3093 | `action=cambiar-pin` con `pin_actual`/`pin_nuevo` | "Mi cuenta" — ingresa PIN actual + nuevo, ambos van server-side. ✓ |
| 3120 | `action=resetear-pin` | Admin/oficina resetean PIN ajeno. Server-side. ✓ |

**No requieren cambios.**

---

## api/tiempos.js

Las referencias son todas **server-side** (nunca llegan al cliente):

| Línea | Código | Evaluación |
|-------|--------|------------|
| 175 | `pin: '1234'` en INSERT defaults | Default al crear empleado nuevo. Server-side. ✓ |
| 494–500 | `login-admin`: `.eq('pin', pin)` | Verificación PIN admin contra Supabase. No devuelve `pin`. ✓ |
| 510–521 | `cambiar-pin`: `.select('pin')` + comparación | Verificación del PIN actual antes de cambiarlo. Server-side. ✓ |
| 524–549 | `verificar-pin`: `.eq('pin', pin)` | Nuevo endpoint. SELECT no incluye `pin` en la respuesta. ✓ |
| 551–573 | `resetear-pin`: `update({ pin: '1234' })` | Reset server-side. No devuelve `pin` en response. ✓ |

---

## js/ (auth.js, supabase-config.js)

**Ninguna ocurrencia.** Los archivos de auth manejan `rol_app` y sesión, no PINs.

---

## Conclusión

Después de este lote, **ningún cliente descarga ni almacena PINs** en ningún flujo:

- `GET empleados` — `pin` eliminado del SELECT (Lote 2)
- Login planta2 — server-side vía `verificar-pin` (este lote)
- Login admin — siempre fue server-side vía `login-admin`
- Cambiar PIN propio — server-side vía `cambiar-pin`
- Resetear PIN ajeno — server-side vía `resetear-pin`

## Deuda pendiente: PIN plain text

Los PINs siguen almacenados en texto plano en la columna `pin` de Supabase.
La comparación server-side es correcta (`.eq('pin', pin)`) pero un volcado de la
tabla o un acceso directo vía Supabase expone todos los PINs. Solución pendiente:
hashear con bcrypt al crear/cambiar PIN, y comparar con bcrypt.compare en el servidor.
Este riesgo se mitiga significativamente con RLS (Lote 1 pendiente).
