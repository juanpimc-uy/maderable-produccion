# Lote 4.1.1 — Validación server-side de item contra proyectos_cache.muebles

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `sql/lote4-1-1-investigacion.md` | Documentación de estructura JSONB y campo que viaja como item_id |
| `api/tiempos.js` | `iniciar-tiempo-oficina`: validación server-side de item contra `proyectos_cache.muebles` |

---

## Qué se agregó

Dentro del bloque `if (CENTROS_CON_ITEM.includes(centro_virtual))`, después
del check de `item_id` presente:

```js
const { data: proyecto, error: pErr } = await supabase
  .from('proyectos_cache')
  .select('muebles')
  .eq('id', proyecto_id)
  .maybeSingle();
if (pErr) throw pErr;
if (!proyecto) return err('Proyecto no encontrado', 404);
const muebles = Array.isArray(proyecto.muebles) ? proyecto.muebles : [];
const itemValido = muebles.some(m => String(m.id) === String(item_id));
if (!itemValido) {
  return err('El item especificado no existe en el proyecto', 400);
}
```

**Por qué solo `m.id` y no `m.codigo`**: el frontend siempre envía `m.id`
(ej. `"mf_0"`) como `item_id`, nunca `m.codigo`. Ver investigación en
`sql/lote4-1-1-investigacion.md`.

**Por qué `String()`**: JSONB puede deserializar el valor como number o string
dependiendo del tipo original al insertar. Los ids actuales son `"mf_N"` (siempre
strings), pero el cast protege ante variaciones futuras.

---

## Casos probados mentalmente

### 1. Centro Modelado, item_id válido del proyecto → insertar OK
El `muebles.some(m => String(m.id) === String(item_id))` retorna `true`.
Se llega al INSERT. **Correcto.**

### 2. Centro Modelado, item_id que existe pero en OTRO proyecto → rechazar 400
Se consulta `proyectos_cache` filtrado por `proyecto_id` (el del proyecto
seleccionado). El mueble de otro proyecto no aparece en ese array → `itemValido = false`
→ 400 "El item especificado no existe en el proyecto". **Correcto.**

### 3. Centro Modelado, item_id inventado ("fantasma") → rechazar 400
`muebles.some(...)` no encuentra ninguna coincidencia → `itemValido = false`
→ 400. **Correcto.**

### 4. Centro Coordinacion (sin item), item_id presente → ignorar e insertar
`CENTROS_CON_ITEM.includes('Coordinacion')` es `false` → el bloque de
validación completo no se ejecuta. Se llega al INSERT con `item_id: null`
(porque `persistirItem = false`). El `item_id` del body se descarta silenciosamente.
**Correcto.**

### 5. Centro Modelado sin item_id → rechazar 400
Primer check dentro del bloque: `if (!item_id) return err(...)`. Se corta
antes de consultar Supabase. Este caso ya andaba en Lote 4.1 y sigue andando.
**Correcto.**

### 6. Proyecto inexistente con item_id válido → rechazar 404
`maybeSingle()` devuelve `data: null` cuando no encuentra fila.
`if (!proyecto) return err('Proyecto no encontrado', 404)`. **Correcto.**

---

## Costo de la validación

Agrega **1 query extra a Supabase** (SELECT muebles FROM proyectos_cache WHERE id = ...)
pero solo cuando el centro requiere item (Shop Drawing, Modelado, Cam) y el
`item_id` está presente. Para los otros centros no hay overhead.

---

## Lo que NO se modificó

- API pública: mismos parámetros de entrada, mismos códigos de respuesta (400, 403, 404, 409)
- Endpoints `tiempo-activo`, `detener-tiempo-oficina`, `centros-virtuales`
- `admin.html`
- Marcado de operarios en `planta2.html`
