# Lote 4.2 Fix — Audit de response shape

## PASO 1 — Response actual de cada endpoint de tiempo

| # | Endpoint | return ok(...) | Shape devuelto | `ok: true`? |
|---|----------|---------------|----------------|-------------|
| 1 | `iniciar-tarea` (planta wrapper) | `return ok(result)` | `{ registro: data }` | ❌ |
| 2 | `finalizar-tarea` (planta wrapper) | `return ok({ registro: result.registro })` | `{ registro: data }` | ❌ |
| 3 | `salida` (planta wrapper) | `return ok(result)` | `{ jornada: data }` | ❌ |
| 4 | `entrada` (planta wrapper) | `return ok(result)` | `{ jornada: data }` | ❌ |
| 5 | `iniciar-tiempo-oficina` (oficina wrapper) | `return ok(result)` | `{ registro: data }` | ❌ ← **BUG** |
| 6 | `detener-tiempo-oficina` (oficina wrapper) | `return ok({ registro, duracion_minutos })` | `{ registro: data, duracion_minutos: N }` | ❌ ← **BUG** |
| 7 | `tiempo-activo` (wrapper) | `return ok(result)` | `{ activo: data\|null, es_descanso: bool }` | ❌ |
| 8 | `iniciar-tarea-v2` | `return ok({ ok: true, ...result })` | `{ ok: true, registro: data }` | ✓ |
| 9 | `finalizar-tarea-v2` | `return ok({ ok: true, ...result })` | `{ ok: true, registro: data, duracion_minutos: N }` | ✓ |
| 10 | `salida-v2` | `return ok({ ok: true, ...result })` | `{ ok: true, jornada: data }` | ✓ |
| 11 | `entrada-v2` | `return ok({ ok: true, ...result })` | `{ ok: true, jornada: data }` | ✓ |
| 12 | `tiempo-activo-v2` | `return ok({ ok: true, ...result })` | `{ ok: true, activo: data\|null }` | ✓ |

---

## PASO 3 — Qué espera admin.html exactamente

### `iniciar-tiempo-oficina`
```js
// admin.html línea ~3682
if (!res.ok || !json.ok) throw new Error(json.error || 'Error al iniciar');
_timerRegistro = json.registro;
```
Necesita: `{ ok: true, registro: {...} }`  
Recibía: `{ registro: {...} }` → `json.ok` era `undefined` → condición `!json.ok` era `true` → lanzaba error aunque el INSERT había ocurrido.

### `detener-tiempo-oficina`
```js
// admin.html línea ~3500
if (!res.ok || !json.ok) throw new Error(json.error || 'Error al detener');
const dur = _fmtDurMin(json.duracion_minutos || 0);
```
Necesita: `{ ok: true, registro: {...}, duracion_minutos: N }`  
Recibía: `{ registro: {...}, duracion_minutos: N }` → mismo problema.

### `tiempo-activo`
```js
// admin.html
const json = await res.json();
if (json.activo) { _timerRegistro = json.activo; ... }
```
**No chequea `json.ok`** — solo lee `json.activo`. No está roto. No requiere cambio.

### planta2.html — `apiPost` y `apiGet`
```js
async function apiPost(action, body) {
  const r = await fetch(...);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || r.statusText); }
  return r.json();
}
```
planta2.html **solo chequea el HTTP status** (`r.ok`), nunca `json.ok`.  
Los wrappers de planta (`iniciar-tarea`, `finalizar-tarea`, `entrada`, `salida`) no necesitan `ok: true`. Se puede agregar sin romper nada (es aditivo), pero no es necesario.

---

## PASO 2 — Fix aplicado

Solo los 2 endpoints rotos:

**`iniciar-tiempo-oficina`:**
```js
// ANTES
return ok(result);
// DESPUÉS
return ok({ ok: true, ...result });
```

**`detener-tiempo-oficina`:**
```js
// ANTES
return ok({ registro: result.registro, duracion_minutos: result.duracion_minutos });
// DESPUÉS
return ok({ ok: true, registro: result.registro, duracion_minutos: result.duracion_minutos });
```

---

## PASO 4 — Casos probados mentalmente

| Caso | Comportamiento esperado | ¿Correcto? |
|------|------------------------|------------|
| **Iniciar timer en admin** → modal → INICIAR | `json.ok = true` → entra a rama éxito → barra amarilla sin error | ✓ |
| **Detener timer en admin** → botón ■ Detener | `json.ok = true` → barra vuelve a gris sin error | ✓ |
| **409 timer doble en admin** | `res.ok = false` → sigue tirando error → modal muestra mensaje | ✓ (no cambia) |
| **Iniciar tarea en planta** | planta no lee `json.ok` → igual que antes | ✓ |
| **Finalizar tarea en planta** | planta no lee `json.ok` → igual que antes | ✓ |
| **Cambiar tarea en planta** | ídem | ✓ |
| **Entrada planta** | planta destructura `{ jornada }` → sigue funcionando | ✓ |
| **Salida planta** | planta no lee response → igual que antes | ✓ |
| **Reload admin con timer activo** | `tiempo-activo` devuelve `{ activo: {...} }` → admin lee `json.activo` → no afectado | ✓ |

---

## Causa raíz

Al convertir los endpoints legacy en wrappers (Lote 4.2), los helpers
devuelven `{ registro: data }` y los wrappers hacían `return ok(result)`,
lo cual descartaba el `ok: true` que admin.html requiere. Los endpoints v2
ya tenían `return ok({ ok: true, ...result })` — los wrappers legacy quedaron
sin el campo.
