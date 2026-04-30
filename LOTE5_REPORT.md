# LOTE 5 — Módulo de Costos por Proyecto

## Resumen

Implementación completa del módulo de costos de mano de obra y materiales por proyecto.

---

## Cambios realizados

### PASO 1 — Investigación previa (`sql/lote5-investigacion.md`)
Informe completo del modelo de datos existente: schema de `proyectos_cache`, estructura de `muebles`, `materiales`, `registros_trabajo`, y gaps identificados para el módulo de costos.

### PASO 2 — Schema SQL (`sql/lote5-schema.sql`)
- Nueva tabla `tarifas_horarias` con 4 categorías: `directo`, `indirecto`, `tecnico`, `administrativo`
- RLS deshabilitado
- 4 filas sembradas con `monto_usd = 0`
- Constraint `empleados_categoria_check` expandido a 4 valores (+ NULL)

### PASO 3 — Endpoints de backend (`api/tiempos.js`)
| Endpoint | Tipo | Descripción |
|---|---|---|
| `tarifas-horarias` | GET | Devuelve las 4 tarifas vigentes |
| `actualizar-tarifa` | POST | Admin only. Actualiza `monto_usd` para una categoría |
| `costos-proyecto` | GET | Admin only. Calcula costo MO + materiales por proyecto |
| `editar-costo-material` | POST | Admin only. Edita `costo_unitario_usd` de un material por índice |

**`costos-proyecto`:** JOIN JS entre `registros_trabajo`, `empleados` (para `categoria`), y `tarifas_horarias`. Devuelve desglose por categoría + materiales con costos editables + totales + conteo de items sin costear.

### PASO 4 — Importar precios desde Zoho (`nuevo-proyecto.html`)
Al importar una SO, los `line_items` ahora incluyen:
- `costo_unitario_usd`: mapeado desde `item.rate`
- `costo_total_usd`: mapeado desde `item.item_total`

Estos campos quedan en `proyectos_cache.materiales` JSONB para ser usados por `costos-proyecto`.

### PASO 5 — Tab "Costos" en detalle de proyecto (`admin.html`)
- Tab visible solo para admin
- Tabla de Mano de Obra: horas por categoría × tarifa = costo
- Tabla de Materiales: cantidad, costo unitario (editable), total
- Total general del proyecto
- Alertas cuando hay horas o materiales sin costear

### PASO 6 — `_editarCostoMat()`
Función en `admin.html` para editar el `costo_unitario_usd` de un material mediante `prompt()`. Llama a `editar-costo-material` y refresca el tab.

### PASO 7 — Sección Tarifas en Ajustes (`admin.html`)
- Sección visible solo para admin en la vista Ajustes
- Carga tarifas al navegar a Ajustes (`tarifasInit()`)
- Inputs editables (type number, step 0.01, min 0)
- Guarda en blur o Enter via `tarifasGuardar()` → POST `actualizar-tarifa`
- Toast de confirmación; muestra fecha de última actualización

### PASO 8 — 4 categorías en modal operario
Ya estaban presentes en el modal `mod-op-cat` desde el lote anterior.

---

## Decisiones de diseño

| Decisión | Detalle |
|---|---|
| Moneda única | Todo en USD. Sin conversión UYU. |
| Sin versionado de tarifas | Una sola tarifa vigente por categoría. Cambiar afecta cálculos históricos. |
| Material index | Los materiales en JSONB no tienen ID persistente. Se usa índice de array. |
| Admin-only | Tab Costos y sección Tarifas visibles solo para `rol_app === 'admin'`. |

---

## SQL a ejecutar en Supabase

```
sql/lote5-schema.sql
```

(Ya preparado, ejecutar manualmente en el SQL Editor de Supabase.)
