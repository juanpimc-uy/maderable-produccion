# Lote 4.3.5 — Hora manual al cerrar jornadas huérfanas

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `api/tiempos.js` | `cerrar-jornada-huerfana` acepta `modo: 'estimada' \| 'manual'` con validación estricta |
| `admin.html` CSS | Clases `.huerfana-card`, `.huerfana-btn-estimada`, `.huerfana-manual-input`, etc. |
| `admin.html` JS | Modal reescrito con show/hide de sección manual y validación en vivo |

---

## Backend: cerrar-jornada-huerfana

**Body nuevo:** `{ empleado_id, jornada_id, modo, salida_manual? }`

| modo | Comportamiento |
|------|---------------|
| `estimada` | Usa el `fin` del último registro de la jornada; si no hay registros, usa la hora de `entrada` |
| `manual` | Usa `salida_manual` (ISO timestamp); valida que sea >= entrada y <= ahora (margen 1min) |

**Eliminado:** modo `ignorar` (entrada=salida), que no tenía uso real.

**Consistencia de registros activos:** cuando se cierra la jornada con cualquier modo, los registros en estado `activo` de esa jornada se cierran con `fin = salida` y `estado = 'pausado'`. Antes se usaba `_finalizarTareaImpl` que siempre ponía `NOW()` — ahora el registro activo también queda con la hora correcta.

---

## Frontend: modal de jornadas huérfanas

Cada card de jornada tiene dos modos:

**Modo estimada (por defecto):**
- Un solo click en "Cerrar con hora estimada (HH:MM)"
- Llama al backend con `modo: 'estimada'`

**Modo manual:**
- Click en "Cerrar con hora manual" → muestra input `datetime-local`
- Default del input: último registro (o entrada si no hay registros), en hora local
- `min` del input = hora de entrada de la jornada
- `max` del input = momento actual
- Validación en vivo (`oninput`):
  - Si valor < entrada: borde rojo + "La hora debe ser después de la entrada (HH:MM)"
  - Si valor > ahora: borde rojo + "La hora no puede ser en el futuro"
  - Si válido: borde normal, sin mensaje
- Click "Confirmar": valida localmente, envía `new Date(inputEl.value).toISOString()`
- Click "Cancelar": vuelve a mostrar los botones estimada/manual
- Errores del backend aparecen inline bajo el input (no alert)

---

## Cómo probar

1. Crear jornada huérfana con SQL:
   ```sql
   INSERT INTO jornadas (empleado_id, fecha, entrada)
   VALUES ('<tu-id>', '2026-04-26', '2026-04-26T08:30:00+00:00');
   ```
2. Recargar admin → badge "⚠ Jornadas sin cerrar (1)"
3. Click en el badge → modal con la jornada
4. Click "Cerrar con hora estimada" → jornada cierra con hora de entrada (sin registros)
5. Para probar manual: insertar jornada nueva → click "Cerrar con hora manual"
6. Probar valores inválidos:
   - Borrar el valor → sin error (campo vacío)
   - Hora antes de la entrada → borde rojo + mensaje
   - Hora en el futuro → borde rojo + mensaje
7. Poner hora válida (ej: 18:30 del 26/04) → Confirmar
8. La card desaparece, badge refresca (o desaparece si era la última)

---

## Casos borde

- `modo: 'manual'` sin `salida_manual` → backend rechaza 400
- `salida_manual` no parseable → backend rechaza 400
- `salida_manual` < entrada → backend rechaza 400 (doble validación: cliente + servidor)
- `salida_manual` > ahora + 1min → backend rechaza 400
- Estimada sin último registro → backend usa `entrada` como salida
- 2 jornadas huérfanas: badge se actualiza tras cada cierre; modal se re-renderiza

---

## Auditoría: por qué no se permite eliminar jornadas

Decisión de producto: el registro histórico debe preservarse siempre, incluso si fue una jornada de prueba. Si el usuario creó una jornada por error, puede cerrarla con hora manual (incluso 1 minuto después de la entrada). Los datos permanecen en la base de datos con su historia completa.
