# PLAN DE MIGRACIÓN — proyectos: localStorage → Supabase

> Stack: HTML estático en Vercel · Supabase xhfeurinovvsbgobkidy · fetch crudo (sin SDK).
> Migración destructiva: no hay datos de producción que preservar.

---

## 1. DECISIÓN DE SCHEMA: Option (a) — Extender proyectos_cache

### Opciones consideradas

**Option (a)**: Seguir usando `proyectos_cache`, completar las columnas que faltan.
- Ya existe en Supabase con PK `id TEXT`.
- Ya hay código que escribe a ella (`guardar-proyecto`, `sync-proyecto`).
- `registros_trabajo.proyecto_id TEXT` ya apunta a estos IDs.
- `planta2.html` ya lee de ella via `proyectos-activos`.

**Option (b)**: Crear tabla nueva `proyectos` + `proyecto_items`.
- Requeriría migrar `registros_trabajo.proyecto_id` y `item_id` a nuevas FKs.
- El campo `item_id` apunta a IDs dentro de un JSONB (`mf_0`, `mf_1`), no a una tabla; normalizarlo requeriría un refactor mayor de planta2.html y todos los registros de trabajo existentes.
- No aporta ventaja para este stack (sin ORM, sin joins complejos).

**Decisión: Option (a).**

Justificación:
1. Las referencias existentes en `registros_trabajo` (TEXT) son compatibles sin cambio.
2. `schema-migration.sql` ya define las columnas necesarias — solo falta ejecutarlo.
3. La estructura JSONB (`muebles`, `materiales`, `modulos`) es adecuada para un ERP con esquema variable por proyecto.
4. Menos código a cambiar = ventana rota más corta.

---

## 2. SQL COMPLETO (DDL)

Ejecutar en Supabase SQL Editor **en este orden**:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1: Asegurarse de que proyectos_cache existe con las columnas originales
-- (ya existe — solo verificar)
-- ════════════════════════════════════════════════════════════════════════════

-- STEP 2: Agregar columnas faltantes (IF NOT EXISTS previene errores si ya corrió)
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS numero        TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS obra          TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS cliente_nombre TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS fecha_inicio  TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS fecha_entrega TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS notas         TEXT;
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS estado        TEXT DEFAULT 'en_produccion';
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS muebles       JSONB DEFAULT '[]';
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS materiales    JSONB DEFAULT '[]';
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS sos_cargadas  JSONB DEFAULT '[]';
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS modulos       JSONB DEFAULT '[]';
ALTER TABLE proyectos_cache ADD COLUMN IF NOT EXISTS creado_en     BIGINT;

-- STEP 3: Índices útiles para las queries más frecuentes
CREATE INDEX IF NOT EXISTS idx_proyectos_cache_activo
  ON proyectos_cache(activo)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_proyectos_cache_numero
  ON proyectos_cache(numero);

-- STEP 4: Normalizar columnas legacy (opcional, para limpieza)
-- La columna 'items' es una copia de 'muebles'; se mantiene por compatibilidad
-- con el endpoint 'proyectos-activos' que hace SELECT *.
-- No se elimina en esta migración.

-- STEP 5: Verificar resultado
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'proyectos_cache'
ORDER BY ordinal_position;
```

**Tablas adicionales** (ya en schema-migration.sql, ejecutar si no están):
```sql
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id TEXT PRIMARY KEY,
  numero TEXT, proveedor TEXT, proyecto_id TEXT, mueble_id TEXT,
  estado TEXT DEFAULT 'pendiente', fecha TEXT, items JSONB DEFAULT '[]',
  creado_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recepciones_material (
  id TEXT PRIMARY KEY, fecha TEXT, proveedor TEXT, oc_num TEXT, obs TEXT,
  items JSONB DEFAULT '[]', impactados JSONB DEFAULT '[]',
  creado_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partidas_terceros (
  id TEXT PRIMARY KEY, tipo TEXT, proyecto_num TEXT, obra TEXT,
  mueble_codigo TEXT, mueble_nombre TEXT, estado TEXT DEFAULT 'en_taller',
  partes TEXT, tipo_despacho TEXT, fecha_despacho TEXT, fecha_recepcion TEXT,
  estado_recep TEXT, obs TEXT, nota TEXT,
  creado_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS despachos (
  id TEXT PRIMARY KEY, proyecto_id TEXT, proyecto_num TEXT, obra TEXT,
  cliente TEXT, fecha TEXT, resp TEXT, transp TEXT, obs TEXT,
  bultos JSONB DEFAULT '[]', total_modulos INTEGER DEFAULT 0,
  verificado BOOLEAN DEFAULT false, bultos_verificados JSONB DEFAULT '[]',
  creado_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config_global (
  clave TEXT PRIMARY KEY,
  valor JSONB,
  actualizado_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. LISTA ORDENADA DE ARCHIVOS A MODIFICAR

### Prioridad 1 — api/tiempos.js (backend)

**Qué cambia:**
- Reemplazar el endpoint `sync-proyecto` (lossy, solo 4 campos) por un redirect a `guardar-proyecto`.
- O simplemente deprecar `sync-proyecto` y apuntar `syncProyectoSupabase()` en admin.html a `guardar-proyecto`.
- El endpoint `proyectos-activos` devuelve SELECT * — asegurarse de que mapea `items` con fallback a `muebles` para planta2.html.

**Cambios concretos:**
1. En `sync-proyecto`: reemplazar la lógica por un upsert completo idéntico a `guardar-proyecto` (o redirigir internamente).
2. Verificar que `proyectos-completos` y `proyectos-activos` incluyen todos los campos necesarios.

---

### Prioridad 2 — admin.html (el módulo más complejo)

**Qué cambia:**

**A. Carga inicial** — reemplazar el IIFE de localStorage por fetch a Supabase:
```js
// ANTES (línea 561–578):
let PROYECTOS = (()=>{
  const stored = JSON.parse(localStorage.getItem('proyectos') || '[]');
  if (!stored.length) return SEED_PROYECTOS;
  return stored.map(p => ({ ...p, items: mapMueblesToItems(p) }));
})();

// DESPUÉS:
let PROYECTOS = [];
(async () => {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/proyectos_cache?activo=eq.true&order=nombre`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const data = await r.json();
  PROYECTOS = (data || []).map(mapProyectoFromDB);
  renderCurrentView();
})();
```

**B. Función de mapeo** — NO perder `centros` ni `nota` de cada ítem:
```js
function mapProyectoFromDB(p) {
  const muebles = p.muebles || p.items || [];
  return {
    ...p,
    nombre: p.obra || p.nombre || '',
    clienteNombre: p.clienteNombre || p.cliente_nombre || p.cliente || '',
    muebles,
    items: muebles.map(m => ({
      id: m.id,
      nombre: [m.codigo, m.nombre].filter(Boolean).join(' – '),
      centros: m.centros || [],     // ← ya no se pierde
      hEst: m.hEst ||
            Object.values(m.horas || {}).reduce((a,v)=>a+Number(v||0), 0),
      nota: m.nota || '',           // ← ya no se pierde
    })),
    materiales: p.materiales || [],
    modulos: p.modulos || [],
  };
}
```

**C. `syncProyectoSupabase()`** — cambiar de `sync-proyecto` a `guardar-proyecto`:
```js
async function syncProyectoSupabase(proyecto) {
  // Construir payload completo (igual que nuevo-proyecto.html guardar())
  const body = {
    id: proyecto.id,
    numero: proyecto.numero || proyecto.nombre,
    obra: proyecto.obra || proyecto.nombre,
    clienteNombre: proyecto.clienteNombre || proyecto.cliente || '',
    fechaInicio: proyecto.fechaInicio,
    fechaEntrega: proyecto.fechaEntrega,
    notas: proyecto.notas || '',
    estado: proyecto.estado || 'en_produccion',
    muebles: proyecto.muebles || [],
    materiales: proyecto.materiales || [],
    sosCargadas: proyecto.sosCargadas || [],
    modulos: proyecto.modulos || [],
    creadoEn: proyecto.creadoEn,
  };
  return fetch('/api/tiempos?action=guardar-proyecto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());
}
```

**D. `syncTodosProyectos()`** — ya no necesita localStorage:
```js
async function syncTodosProyectos() {
  // PROYECTOS ya viene de Supabase; solo re-guardar para forzar sincronización
  if (!PROYECTOS.length) { alert('No hay proyectos cargados'); return; }
  // ... resto igual pero sin leer localStorage
}
```

**E. `guardarProyecto()` y otras funciones inline** — actualizar en memoria + llamar a Supabase:
```js
// Reemplazar: localStorage.setItem('proyectos', ...) + syncProyectoSupabase(pr)
// Por:        solo syncProyectoSupabase(pr) (que ya hace upsert completo)
```

**F. Eliminar `SEED_PROYECTOS`** — ya no se necesita el fallback a datos demo.

---

### Prioridad 3 — nuevo-proyecto.html

**Qué cambia:**
- `filtrarODFs()` ya usa `_proyectosCache` (no localStorage directo).
- `guardar()` ya llama a `guardar-proyecto` API.
- **Único ajuste**: asegurarse de que `_proyectosCache` se carga solo de Supabase (ya lo hace con el fetch al init).
- Eliminar la escritura a localStorage('proyectos') en `guardar()` — es redundante si Supabase es la fuente de verdad.

---

### Prioridad 4 — materiales.html

**Qué cambia:**
- El IIFE de carga ya hace fetch a Supabase. OK.
- `confirmarRecepcion()` ya llama a `guardar-proyecto` para cada proyecto afectado. OK.
- **Ajuste**: en `confirmarRecepcion()`, después de actualizar PROYECTOS en memoria, re-fetchear desde Supabase para reflejar cambios (o confiar en el upsert y mantener en memoria).
- Eliminar fallback a demo data (ya eliminado).

---

### Prioridad 5 — tercerizados.html

**Qué cambia:**
- `_PROYECTOS` ya se carga de Supabase via fetch al init. OK.
- No escribe proyectos.
- Sin cambios adicionales necesarios.

---

### Prioridad 6 — despacho.html

**Qué cambia:**
- Carga ya va a Supabase via fetch. OK.
- `guardarDespacho()` ya llama a `guardar-despacho`. OK.
- **Gap**: cuando se marcan módulos como despachados (línea 571), se actualiza PROYECTOS en memoria y localStorage pero **no** se llama a `guardar-proyecto` para persistir los modulos actualizados en Supabase. Agregar esa llamada.

---

### Prioridad 7 — stock-placas.html

**Sin cambios** — no usa proyectos.

---

## 4. ESTRATEGIA DE FETCH (fetch crudo, sin SDK)

### Constantes globales (agregar en cada HTML que necesite acceso directo)

```js
const SUPABASE_URL  = 'https://xhfeurinovvsbgobkidy.supabase.co';
const SUPABASE_ANON_KEY = ''; // pegar aquí la anon key del proyecto
// La anon key es pública por diseño; el acceso está controlado por RLS.
// Para esta app interna sin RLS activo, la anon key es suficiente para leer.
// Las escrituras van a través de /api/tiempos (Vercel Edge) que usa la service key.
```

### Helper genérico de fetch crudo

```js
async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: opts.single ? 'return=representation' : 'return=representation',
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Uso:
// GET proyectos activos
const proyectos = await sbFetch('proyectos_cache?activo=eq.true&order=nombre');

// GET proyecto por ID
const [proyecto] = await sbFetch(`proyectos_cache?id=eq.${id}`);

// Nota: las escrituras siguen via /api/tiempos (Vercel proxy con service key)
// para no exponer la service key en el HTML.
```

### Decisión sobre escrituras

Las escrituras sensibles (INSERT, UPDATE, UPSERT) **siguen pasando por `/api/tiempos`** porque:
1. El service key NO debe estar en HTML estático público.
2. El proxy de Vercel Edge ya está implementado.
3. La anon key con RLS deshabilitado permite lecturas pero no escrituras seguras.

Para **lecturas** desde admin.html, se puede usar fetch crudo con anon key (más rápido, sin cold start de Edge Function). Para **escrituras** se mantiene el proxy.

---

## 5. PLAN DE VERIFICACIÓN post-migración

### Checklist funcional

**nuevo-proyecto.html**
- [ ] El formulario de 5 pasos completa sin errores
- [ ] Al guardar, el proyecto aparece en Supabase `proyectos_cache` con todos los campos (verificar en Table Editor)
- [ ] `filtrarODFs()` marca como "Ya cargada" un ODF que ya tiene proyecto en Supabase
- [ ] Redirige a admin.html tras guardar

**admin.html — Dashboard**
- [ ] El dashboard carga PROYECTOS desde Supabase (no seed hardcodeado)
- [ ] KPIs muestran valores correctos
- [ ] Dashboard de operarios **no muestra "undefined undefined"** en columna CENTRO
- [ ] Horas reales en resumen de proyecto **no muestran 0%** (requiere también que `registros-proyecto` funcione)

**admin.html — Vista de Proyecto**
- [ ] Pestaña Ítems muestra ítems del proyecto con `hEst` correcto
- [ ] Pestaña Materiales muestra materiales
- [ ] Pestaña Tiempos muestra sesiones de Supabase
- [ ] Editar nombre/muebles → guardar → reload muestra cambios
- [ ] "↑ Sincronizar todos a planta" no falla ni pierde campos

**planta2.html (tablet de planta)**
- [ ] Lista de proyectos se muestra al iniciar tarea (PASO 1)
- [ ] Ítems del proyecto aparecen en PASO 2
- [ ] Centros se muestran con el último registro en PASO 3
- [ ] Confirmar tarea registra en `registros_trabajo` con `proyecto_id` correcto
- [ ] Planta2 muestra `"Sin proyectos activos"` si proyectos_cache está vacía (no crashea)

**materiales.html**
- [ ] Proyectos cargados desde Supabase al abrir la página
- [ ] Confirmar recepción de material actualiza `mat.recibido` y persiste en Supabase
- [ ] OCs se muestran y se pueden crear

**tercerizados.html**
- [ ] Modal "Nueva Partida" muestra proyectos de Supabase en el dropdown
- [ ] Muebles filtran por flujo (tap/lus) correctamente

**despacho.html**
- [ ] Selector de proyectos muestra proyectos de Supabase
- [ ] Módulos pendientes de despacho se muestran correctamente
- [ ] Confirmar despacho actualiza módulos en Supabase

### Queries SQL de verificación

```sql
-- Verificar que los proyectos tienen todos los campos
SELECT id, numero, obra, cliente_nombre, estado,
       jsonb_array_length(muebles) as n_muebles,
       jsonb_array_length(materiales) as n_materiales,
       jsonb_array_length(modulos) as n_modulos,
       sincronizado_at
FROM proyectos_cache
ORDER BY sincronizado_at DESC
LIMIT 20;

-- Verificar que los registros_trabajo apuntan a proyectos existentes
SELECT DISTINCT rt.proyecto_id,
       pc.nombre,
       COUNT(rt.id) as n_registros
FROM registros_trabajo rt
LEFT JOIN proyectos_cache pc ON pc.id = rt.proyecto_id
GROUP BY rt.proyecto_id, pc.nombre
ORDER BY n_registros DESC;

-- Verificar horas por proyecto (debería coincidir con admin.html)
SELECT proyecto_id, proyecto_nombre,
       ROUND(SUM(EXTRACT(EPOCH FROM (fin - inicio))/3600)::numeric, 2) as horas_reales
FROM registros_trabajo
WHERE fin IS NOT NULL AND estado != 'pausado'
GROUP BY proyecto_id, proyecto_nombre
ORDER BY horas_reales DESC;
```

---

## 6. ORDEN DE CUTOVER y riesgos

### Fases y ventana rota

```
FASE 0 — Preparación (sin cambios de código, sin ventana rota)
  ├─ Ejecutar schema-migration.sql en Supabase
  ├─ Verificar columnas creadas con el SELECT del STEP 5
  └─ Confirmar anon key disponible

FASE 1 — Backend api/tiempos.js (deploy a Vercel, sin rotura)
  ├─ Parchar sync-proyecto para que sea full-upsert (no lossy)
  └─ Verificar que proyectos-activos y proyectos-completos funcionan

FASE 2 — nuevo-proyecto.html (deploy, sin rotura)
  ├─ Crear proyectos de prueba end-to-end
  └─ Verificar en Supabase Table Editor que todos los campos llegan

FASE 3 — admin.html (deploy, ⚠ VENTANA ROTA CORTA ~5 min)
  ├─ Reemplazar carga desde localStorage por fetch a Supabase
  ├─ Actualizar syncProyectoSupabase para usar guardar-proyecto
  ├─ Remover SEED_PROYECTOS
  ├─ Actualizar mapeo de muebles → items (preservar centros, nota)
  └─ Test: abrir admin.html y verificar que PROYECTOS se carga

FASE 4 — Módulos secundarios (deploy, sin rotura significativa)
  ├─ materiales.html — ya tiene fetch, solo limpiar demo data
  ├─ tercerizados.html — ya tiene fetch, OK
  ├─ despacho.html — agregar guardar-proyecto al despachar módulos
  └─ nuevo-proyecto.html — limpiar escritura a localStorage

FASE 5 — Limpieza (sin ventana rota)
  ├─ Remover localStorage.setItem('proyectos') de todas partes
  ├─ Remover sync-proyecto del API (o mantener por retrocompatibilidad)
  └─ Remover datos demo hardcodeados (SEED_PROYECTOS, demo arrays)
```

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|:---:|--------|
| schema-migration.sql no corrió → columnas faltantes → upsert falla | Alta | Verificar con SELECT antes de deployar código |
| admin.html muestra vacío porque Supabase devuelve array vacío | Media | Mostrar mensaje "Crear el primer proyecto" en lugar de crash |
| `items` en proyectos_cache vacío para proyectos creados via `sync-proyecto` (lossy) | Alta | Re-sincronizar todos los proyectos con "Sincronizar todos" ANTES de la FASE 3 |
| planta2.html no encuentra ítems porque `items` está vacío en proyectos_cache | Alta | Misma mitigación: sincronizar primero |
| admin.html PROYECTOS vacío durante la carga async → renderCurrentView crashea | Media | Inicializar PROYECTOS = [] y hacer renderCurrentView idempotente con array vacío |
| La anon key no tiene permisos de lectura sin RLS | Baja | Verificar en Supabase Dashboard: Authentication → Policies → proyectos_cache |
| admin.html pierde historial de sesiones (SESIONES/HISTORIAL vienen de localStorage) | — | Estos NO se migran en esta fase — se mantienen en localStorage como está |

### Nota sobre datos existentes en localStorage

Como la migración es **destructiva**, no hay script de migración de datos:
1. Los proyectos en localStorage existentes **se pueden ignorar** — están incompletos (solo 4 campos via sync-proyecto).
2. Los proyectos se recrean desde nuevo-proyecto.html o desde un import manual.
3. Los `registros_trabajo` existentes en Supabase siguen siendo válidos — sus `proyecto_id` son strings que coincidirán con los nuevos proyectos si se usan los mismos IDs.

---

*Próximo paso: ejecutar schema-migration.sql en Supabase, luego FASE 1 (api/tiempos.js).*
