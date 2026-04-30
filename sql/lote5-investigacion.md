# Lote 5 — Investigación: Módulo de Costos por Proyecto

## PARTE A — Modelo de proyecto y materiales

### 1. Schema de `proyectos_cache`

Inferido de `schema-migration.sql` + upsert en `api/tiempos.js`:

```
id                TEXT          PRIMARY KEY
nombre            TEXT          (alias de numero)
numero            TEXT
obra              TEXT
cliente           TEXT          (alias de cliente_nombre)
cliente_nombre    TEXT
fecha_inicio      TEXT          (YYYY-MM-DD)
fecha_entrega     TEXT
notas             TEXT
estado            TEXT          DEFAULT 'en_produccion'
muebles           JSONB         DEFAULT '[]'
items             JSONB         (alias de muebles, escrito en mismo upsert)
materiales        JSONB         DEFAULT '[]'
sos_cargadas      JSONB         DEFAULT '[]'
modulos           JSONB         DEFAULT '[]'
creado_en         BIGINT        (ms epoch desde el cliente)
activo            BOOLEAN       DEFAULT true
sincronizado_at   TIMESTAMPTZ   DEFAULT NOW()
```

No existen campos `monto_so`, `monto_materiales`, `items_so` ni nada de precios a nivel de proyecto.

---

### 2. Objeto guardado en Supabase — `guardar-proyecto`

```js
// api/tiempos.js
await supabase.from('proyectos_cache').upsert({
  id, nombre: numero || obra, numero, obra,
  cliente: clienteNombre, cliente_nombre: clienteNombre,
  fecha_inicio: fechaInicio, fecha_entrega: fechaEntrega,
  notas, estado: estado || 'en_produccion',
  muebles: muebles || [], items: muebles || [],   // mismo array, dos columnas
  materiales: materiales || [],
  sos_cargadas: sosCargadas || [],
  modulos: modulos || [],
  creado_en: creadoEn,
  activo: activoBody !== undefined ? activoBody : true,
  sincronizado_at: new Date().toISOString(),
}, { onConflict: 'id' })
```

---

### 3. Estructura de `muebles` (JSONB array)

Cada elemento del array `muebles`:

```js
{
  id: 'mf_' + i,                // string único
  codigo: item.item_code || item.sku || 'MF01',  // código del ítem en Zoho
  nombre: item.name || item.description,
  cant: item.quantity || 1,      // cantidad de unidades
  flujos: [],                    // ['tapiceria', 'herreria', ...] centros que aplican
  hrsExtra: {                    // horas extra manuales por proceso
    tapiceria: 0,
    herreria: 0,
    lustre: 0,
    electricidad: 0,
    madera_maciza: 0,
  },
  placas: 4,                     // cant. de placas CNC
  dif: 2,                        // factor de dificultad (1=fácil, 2=normal, 3=difícil)
  horas: {                       // horas estimadas calculadas: placas × coef × factor_dif
    corte: 0.8,
    enchapado: 0.4,
    armado: 1.2,
    revision: 0.2,
    empaquetado: 0.1,
  },
  mats: [],                      // materiales del mueble — VER NOTA
  odfId: invoiceId,              // ID de factura Zoho de origen
}
```

**NOTA importante sobre `mats`:** Se inicializa vacío. Los materiales
se agregan desde admin.html manualmente o vía SO, pero **NO se copian
automáticamente desde Zoho al crear el proyecto**. Los mats agregados
vía admin tienen:

```js
{
  id: 'mat_' + Date.now(),
  nombre: 'MDF 18mm',
  unidad: 'planchas',
  requerido: 10,
  recibido: 0,
  critico: true,          // si bloquea producción
  manual: true,           // true si fue cargado a mano
  soOrigen: 'SO-1234',
  sku: 'MDF-18',          // solo si vino de Zoho
}
```

---

### 4. Estructura de `materiales` (JSONB array — nivel proyecto, no por mueble)

```js
{
  id: 'mat_' + Date.now() + '_' + i,
  nombre: item.name || item.description,
  unidad: item.unit || 'unidades',
  requerido: item.quantity || 0,
  recibido: 0,
  soOrigen: 'SO-1234',
  sku: item.sku,           // presente si se importó desde artículo de Zoho
}
```

**⚠ SIN PRECIOS.** Ni `muebles[i].mats` ni el array `materiales` del
proyecto tienen campos de precio unitario, precio total, ni moneda.
Los `line_items` de Zoho SÍ traen `rate` y `item_total`, pero el código
actual solo extrae `item_code`, `name`, `description`, `quantity`.

---

### 5. Tablas relacionadas adicionales

```sql
-- ordenes_compra (schema-migration.sql)
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id          TEXT PRIMARY KEY,
  numero      TEXT,
  proveedor   TEXT,
  proyecto_id TEXT,
  mueble_id   TEXT,
  estado      TEXT DEFAULT 'pendiente',
  fecha       TEXT,
  items       JSONB DEFAULT '[]',
  creado_at   TIMESTAMPTZ DEFAULT NOW()
);

-- recepciones_material
CREATE TABLE IF NOT EXISTS recepciones_material (
  id          TEXT PRIMARY KEY,
  fecha       TEXT,
  proveedor   TEXT,
  oc_num      TEXT,
  obs         TEXT,
  items       JSONB DEFAULT '[]',
  impactados  JSONB DEFAULT '[]',
  creado_at   TIMESTAMPTZ DEFAULT NOW()
);
```

Estas tablas son para el flujo de OC/recepción física. No tienen campos
de costo tampoco.

---

## PARTE B — Empleados y categorías

### 6. Campo `categoria` en empleados

Valores actuales (inferidos del código):

```
"directo"    — empleado directo de producción (operario de planta)
"indirecto"  — empleado indirecto (oficina, supervisión)
```

```js
// admin.html — select en modal editar operario
<option value="directo">Directo</option>
<option value="indirecto">Indirecto</option>
```

Campo `rol_app` (tabla `empleados`): `'operario' | 'oficina' | 'admin'`

### 7. ¿Existe tabla `tarifas_horarias` o `costos_categoria`?

**NO EXISTE.** No hay ninguna tabla ni estructura en el código que
defina un costo por hora por categoría. El módulo de costos deberá
crearla desde cero.

---

## PARTE C — Modelo de tiempos

### 8. ¿`registros_trabajo` tiene `proyecto_id`?

**SÍ.** Schema (comentario en `api/tiempos.js` línea ~17):

```
id               UUID     PRIMARY KEY DEFAULT gen_random_uuid()
empleado_id      TEXT     NOT NULL
jornada_id       UUID
proyecto_id      TEXT     NULLABLE     ← FK lógica a proyectos_cache.id
proyecto_nombre  TEXT
item_id          TEXT                  ← ID del mueble
item_nombre      TEXT
centro           TEXT                  ← nombre del centro virtual
inicio           TIMESTAMPTZ NOT NULL DEFAULT NOW()
fin              TIMESTAMPTZ NULLABLE
estado           TEXT     DEFAULT 'activo'   (activo|pausado|finalizado|retrabajo)
es_retrabajo     BOOLEAN  DEFAULT false
motivo_retrabajo TEXT
creado_at        TIMESTAMPTZ DEFAULT NOW()
```

Para obtener la categoría del empleado: JOIN `empleados` por `empleado_id`.

### 9. Registros con `proyecto_id NULL`

**SÍ existen.** En `_iniciarTareaImpl`:

```js
proyecto_id: es_descanso ? null : (proyecto_id || null),
```

También para centros virtuales sin proyecto asignado (Coordinacion,
Reunion, Supervision, Compras, Modelado, Cam) el proyecto_id puede ser
null si el empleado no seleccionó proyecto.

Centros virtuales con `es_descanso = true`:
- `Descanso` → siempre `proyecto_id = null`

Centros que pueden tener `proyecto_id = null`:
- Cam, Compras, Coordinacion, Modelado, Reunion, Supervision

### 10. Query de horas por proyecto × categoría

El endpoint `registros-todos` (`action=registros-todos&dias=60`) hace:

```js
await supabase.from('registros_trabajo').select('*')
  .gte('inicio', desde.toISOString()).order('inicio', { ascending: false })
```

**No incluye `categoria` del empleado** — solo `empleado_id`.

Para el módulo de costos se necesitará un query con JOIN:

```sql
SELECT
  rt.proyecto_id,
  rt.proyecto_nombre,
  e.categoria,
  SUM(EXTRACT(EPOCH FROM (rt.fin - rt.inicio))/3600) AS horas
FROM registros_trabajo rt
JOIN empleados e ON e.id = rt.empleado_id
WHERE rt.fin IS NOT NULL
  AND rt.proyecto_id IS NOT NULL
GROUP BY rt.proyecto_id, rt.proyecto_nombre, e.categoria
ORDER BY rt.proyecto_nombre, e.categoria;
```

**Este query no tiene un endpoint dedicado hoy.** El único endpoint
relacionado es `registros-proyecto` que devuelve horas totales (sin
desglosar por categoría):

```js
// api/tiempos.js — action 'registros-proyecto'
await supabase.from('registros_trabajo')
  .select('inicio, fin, estado, empleado_id, item_id, centro')
  .eq('proyecto_id', proyecto_id)
  .not('fin', 'is', null)
// Devuelve: { horas_totales, registros }
```

---

## PARTE D — Vinculación con Zoho

### 11. Endpoints de Zoho consumidos

Todos pasan por el proxy `/api/zoho-books.js`:

```js
// Proxy: api/zoho-books.js
GET /api/zoho-books?endpoint={zohoEndpoint}&token={accessToken}
// → https://www.zohoapis.com/books/v3/{endpoint}&organization_id={ZOHO_ORG_ID}
```

| Uso | Endpoint Zoho |
|-----|--------------|
| Listar facturas (ODFs) | `invoices?per_page=200&sort_column=date&sort_order=D` |
| Detalle de factura | `invoices/{invoiceId}` |
| Buscar factura por número | `invoices?invoice_number={num}` |
| Listar SOs | `salesorders?salesorder_number={num}` |
| Detalle de SO | `salesorders/{soId}` |
| Listar artículos del catálogo | `items?search_text={q}` (desde admin.html) |

**Flujo de carga de proyecto:**
1. nuevo-proyecto.html: usuario ingresa número de ODF
2. Token Zoho obtenido vía `getZohoToken()` (OAuth, client credentials)
3. Factura buscada → `line_items` mapeados a `muebles[]`
4. Usuario puede cargar SOs → `line_items` mapeados a `materiales[]`
5. `guardar-proyecto` persiste todo en `proyectos_cache`

### 12. Precios de artículos: ¿USD o UYU?

**Los precios NO se extraen actualmente.** Los `line_items` de Zoho sí
contienen `rate` (precio unitario) y `item_total`, pero el código solo
extrae:

```js
// nuevo-proyecto.html
muebles = items.map((item, i) => ({
  codigo: item.item_code || item.sku || ...,
  nombre: item.name || item.description || '',
  cant:   item.quantity || 1,
  // ← NO se extraen item.rate, item.unit_price, item.item_total
}));
```

Zoho Books Uruguay típicamente maneja moneda en **USD** para materiales
importados y **UYU** para servicios. La moneda no está normalizada en el
código. **El módulo de costos deberá definir la política de moneda.**

---

## PARTE E — UI actual

### 13. Pantalla de detalle de proyecto

Existe dentro de `admin.html`, sección Proyectos. La lista se oculta
y aparece `#pr-detalle` con 4 sub-tabs:

| Tab | Contenido actual |
|-----|-----------------|
| `resumen` | KPIs (horas real vs est.), barras por centro y por operario |
| `ítems` | Tabla de muebles con placas, dificultad, flujos, hrs estimadas editables |
| `materiales` | Lista de materiales por mueble (semáforo recibido/requerido) |
| `tiempos` | Tabla por mueble: horas reales vs estimadas + sesiones expandibles |

**No existe tab `costos`.** Ese es el gap a llenar en LOTE 5.

### 14. Vista "Tiempos" en el sidebar

```html
<div class="nav-item" onclick="navTo('tiempos')">⬗ Tiempos</div>
```

Muestra horas totales del proyecto seleccionado (en un selector de
proyectos propio), distribución por centro y por operario, y las
sesiones activas. Es una vista de seguimiento en vivo — **no muestra
costos ni tarifas**.

### 15. ¿Cómo se calculan las horas hoy?

Las funciones `hAcumPr`, `hByCentro`, `hByOp` calculan sobre arrays
en memoria:

```js
let SESIONES  = JSON.parse(localStorage.getItem('sesiones')  || '[]');
let HISTORIAL = JSON.parse(localStorage.getItem('historial') || '[]');
// Actualizados al init desde: GET /api/tiempos?action=registros-todos&dias=60
```

`registros-todos` hace `select('*')` sin JOIN a `empleados`. Por lo
tanto, **el campo `categoria` del empleado no está disponible** en
SESIONES/HISTORIAL actuales. Se necesitaría o bien un nuevo endpoint
con JOIN, o un lookup cliente contra `OPERARIOS`.

---

## RESUMEN EJECUTIVO — GAPS PARA EL MÓDULO DE COSTOS

| Qué falta | Impacto |
|-----------|---------|
| **Tabla `tarifas_horarias`** | Sin ella no hay costo/hora por categoría |
| **Campo `categoria`** en `registros-todos` o endpoint nuevo | El desglose de costo por tipo de empleado requiere JOIN |
| **Precios en muebles/materiales** | Zoho los tiene pero no se extraen |
| **Política de moneda** | USD vs UYU no definida; tipo de cambio no manejado |
| **Tab `costos` en detalle de proyecto** | La UI no existe aún |
| **Endpoint `costos-proyecto`** | No existe — hay que crearlo |

### Propuesta de diseño mínimo viable

1. **Nueva tabla `tarifas_horarias`:**
   ```sql
   CREATE TABLE tarifas_horarias (
     id        BIGSERIAL PRIMARY KEY,
     categoria TEXT NOT NULL UNIQUE,  -- 'directo' | 'indirecto'
     tarifa_uh NUMERIC NOT NULL,      -- costo por hora en moneda base (UYU)
     vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE
   );
   ```

2. **Nuevo endpoint `GET costos-proyecto`:**
   - JOIN `registros_trabajo` × `empleados` × `tarifas_horarias`
   - Agrupa por proyecto_id, categoria, item_id
   - Devuelve: horas × tarifa = costo_mano_obra por categoría y por mueble

3. **Tab `costos` en detalle de proyecto (admin.html):**
   - Desglose: mano de obra (directo/indirecto) + materiales
   - Total proyecto en UYU

4. **Precios de materiales:**
   - Opción A: extraer `rate` de Zoho al importar la SO (precio en USD, convertir a UYU)
   - Opción B: campo `precio_uy` editable manualmente en cada material
