# Lote 4.1 — Investigación: items de proyecto

## 1. Cómo se obtienen los items en planta2.html

Los items NO tienen tabla propia en Supabase. Están embebidos como JSONB en
`proyectos_cache.muebles` (array). Cada mueble tiene:

```json
{
  "id":     "mf_0",
  "codigo": "MF01",
  "nombre": "CARRITO Equipamiento con patas",
  "cant":   10,
  "dif":    2,
  "horas":  {"corte": 2, "armado": 3.2, ...},
  "mats":   [],
  "flujos": [...],
  "placas": 0,
  "hrsExtra": 0,
  "odfId":  "752082000018397014"
}
```

Campos relevantes para el timer: `id`, `codigo`, `nombre`.

En planta2.html los items llegan embebidos en el objeto proyecto, que se
obtiene de `GET /api/tiempos?action=proyectos-activos`. No hay endpoint
separado de items.

## 2. ¿Hay endpoint de "items de un proyecto"?

No. Los items se traen con el proyecto entero. El endpoint
`proyectos-activos` devuelve todo `proyectos_cache` incluyendo el JSONB
`muebles`.

## 3. ¿Admin.html ya tiene los items cargados?

Sí. `cargarTodoDesdeSupabase()` carga `PROYECTOS` via `sbFetch('proyectos_cache?...')`.
`mapProyectoFromDB()` transforma `muebles` en `items` con formato:
```js
items: muebles.map(m => ({
  id:     m.id,
  nombre: [m.codigo, m.nombre].filter(Boolean).join(' – '), // "MF01 – CARRITO..."
  centros: m.centros || [],
  hEst:   m.hEst || ...,
  nota:   m.nota || ''
}))
```

**Pero** el modal del Lote 4 NO usa `PROYECTOS` — carga proyectos con un
fetch separado a `proyectos-activos` y guarda solo `{id, numero, nombre, cliente_nombre}`
en `_cvProyectos`. Hay que agregar `muebles` a ese mapeado.

## 4. Qué se persiste en registros_trabajo

Campos: `item_id` (string, ej. `"mf_0"`) y `item_nombre` (string libre, ej.
`"MF01 · CARRITO Equipamiento con patas"`). Mismo patrón que `iniciar-tarea`
del endpoint de operarios (línea 270 en api/tiempos.js).

No hay validación server-side de que el item exista en el proyecto (los items
son JSONB, no una tabla normalizada). La validación es confianza en el cliente
o verificando el JSONB del proyecto — se optó por no validar server-side para
evitar cargar el proyecto completo en el endpoint (los proyectos pueden ser grandes).

## 5. Formato de display elegido para el timer

`"{codigo} · {nombre}"` — ejemplo: `"MF01 · CARRITO Equipamiento con patas"`

Este string se guarda como `item_nombre` en `registros_trabajo`. En la barra
de timer se extrae el `codigo` del `item_nombre` spliteando por ` · `.
