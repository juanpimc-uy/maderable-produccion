# Lote 4.1.1 — Investigación: estructura JSONB de muebles

## 1. Estructura de `proyectos_cache.muebles`

Es un **array de objetos** (confirmado por uso de `Array.isArray()` y
`.forEach()`, `.map()`, `.find()` en toda la app sin conversión previa).

Objeto mueble de ejemplo (extraído de admin.html usos):

```json
{
  "id":      "mf_0",
  "codigo":  "MF01",
  "nombre":  "CARRITO Equipamiento con patas",
  "cant":    10,
  "dif":     2,
  "horas":   { "corte": 2, "armado": 3.2 },
  "mats":    [],
  "flujos":  [],
  "placas":  0,
  "hrsExtra": 0,
  "odfId":   "752082000018397014"
}
```

Campos de identificación:
- **`id`** — string con prefijo `"mf_"` seguido de índice (ej. `"mf_0"`, `"mf_1"`).
  Es el identificador único del mueble dentro del proyecto.
- **`codigo`** — string corto legible (ej. `"MF01"`). No es único a nivel
  global (dos proyectos distintos pueden tener `"MF01"`).

El campo `id` es lo que se usa como clave de búsqueda en todo el código:
`pr.muebles.find(x => x.id === ses.itemId)`, `pr.muebles.find(x => x.id === mId)`, etc.

## 2. ¿Qué manda el frontend como `item_id`?

En `_timerPoblarItems()` (admin.html):

```js
sel.innerHTML = '<option value="">— Elegí un item —</option>' +
  items.map(m => {
    const label = m.codigo ? `${m.codigo} · ${m.nombre}` : m.nombre;
    return `<option value="${m.id}" data-nombre="${label}">${label}</option>`;
  }).join('');
```

El `value` del `<option>` es **`m.id`** (ej. `"mf_0"`).

En `_timerSelItemFn()`:
```js
_timerSelItem = { id: sel.value, nombre: opt.dataset.nombre || opt.textContent };
```

En `_timerIniciar()`, el payload incluye:
```js
item_id: _timerSelItem.id,   // ← m.id del mueble
item_nombre: _timerSelItem.nombre,
```

**Conclusión**: el `item_id` que viaja en el POST es el campo `m.id` del
objeto mueble (ej. `"mf_0"`). NO es `m.codigo`.

## 3. Estrategia de validación

La query correcta a ejecutar server-side:

```js
const muebles = Array.isArray(proyecto.muebles) ? proyecto.muebles : [];
const itemValido = muebles.some(m => String(m.id) === String(item_id));
```

- Solo comparar por `m.id` (no por `m.codigo`) — `m.id` es el identificador
  único del mueble, `m.codigo` es legible pero no es lo que envía el cliente.
- `String(...)` como precaución: JSONB puede deserializar números como number
  o string dependiendo del tipo original en el JSON insertado. Los `"mf_X"` son
  siempre strings, pero si en el futuro se usan IDs numéricos el cast protege.
- No se valida `m.codigo` en este contexto — el cliente siempre manda `m.id`.
