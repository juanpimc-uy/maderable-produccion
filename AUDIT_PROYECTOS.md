# AUDIT — proyectos en localStorage

> Generado 2026-04-26. Scope: admin.html, planta2.html, nuevo-proyecto.html,
> materiales.html, tercerizados.html, despacho.html, stock-placas.html,
> api/tiempos.js.

---

## 1. LECTURAS de localStorage.getItem('proyectos')

### nuevo-proyecto.html

**Línea 419** — `filtrarODFs()`
```js
// 418: function filtrarODFs(query){
// 419:   const proyStorage=_proyectosCache;
// 420:   const yaIds=new Set(proyStorage.map(p=>p.odfId).filter(Boolean));
```
- `_proyectosCache` se inicializa en línea 918 con `JSON.parse(localStorage.getItem('proyectos')||'[]')`
- Uso: construye Sets de IDs y números ya cargados para mostrar "Ya cargada" en la lista de ODFs de Zoho.

**Línea 918** — init al final del script
```js
// 917:
// 918: let _proyectosCache=JSON.parse(localStorage.getItem('proyectos')||'[]');
// 919: fetch('/api/tiempos?action=proyectos-completos').then(r=>r.json()).then(d=>{
// 920:   if(d.proyectos){_proyectosCache=d.proyectos;localStorage.setItem('proyectos',...);}
```
- Uso: cache local para `filtrarODFs`; se reemplaza inmediatamente con datos frescos de Supabase.

---

### materiales.html

**Línea 264** — init
```js
// 263:
// 264: let PROYECTOS = JSON.parse(localStorage.getItem('proyectos') || '[]');
// 265: let OCS       = JSON.parse(localStorage.getItem('ocs')       || '[]');
// 266: let RECEPCIONES = JSON.parse(localStorage.getItem('recepciones') || '[]');
```
- Uso: carga inicial para renderizar KPIs, tabla de OCs y estado por mueble. Inmediatamente sobreescrito por fetch a Supabase.

**Línea 506** — `confirmarRecepcion()` (escribe y después vuelve a leer en `guardar-proyecto` POST)
```js
// 505: // persistir todo
// 506: localStorage.setItem('proyectos', JSON.stringify(PROYECTOS));
// 507: localStorage.setItem('ocs',        JSON.stringify(OCS));
// 508: localStorage.setItem('recepciones',JSON.stringify(RECEPCIONES));
// 509: // sync a Supabase
// 510: PROYECTOS.forEach(p=>fetch('/api/tiempos?action=guardar-proyecto',...));
```

---

### tercerizados.html

**Línea 235** — init
```js
// 234: let PROVS = JSON.parse(localStorage.getItem('proveedores') || ...);
// 235: let _PROYECTOS = JSON.parse(localStorage.getItem('proyectos') || '[]');
```
- Uso: se usa únicamente para poblar el dropdown de proyectos en el modal "Nueva Partida".

**Líneas 515, 552, 573** — `abrirNuevaPartida()`, `onNuevaPr()`, `confirmarNueva()`
```js
const proyectos = _PROYECTOS;  // variable module-level ya inicializada
```
- Uso: lookup de `pr.muebles` para filtrar por flujo (`tap` / `lus`) y obtener la lista de muebles del proyecto.

---

### despacho.html

**Línea 245** — init
```js
// 244:
// 245: let PROYECTOS = JSON.parse(localStorage.getItem('proyectos') || '[]');
// 246: let DESPACHOS = JSON.parse(localStorage.getItem('despachos') || '[]');
```
- Uso: llena el `<select>` de proyectos en `init()`, muestra módulos pendientes de despacho.

---

### admin.html

**Línea 562** — init del módulo (IIFE)
```js
// 560: // Cargar proyectos: localStorage primero, luego seed
// 561: let PROYECTOS = (()=>{
// 562:   const stored = JSON.parse(localStorage.getItem('proyectos') || '[]');
// 563:   if (!stored.length) return SEED_PROYECTOS;
// 564:   return stored.map(p => ({
// 565:     ...p,
// 566:     nombre: p.obra || p.nombre || '',
// 567:     clienteNombre: p.clienteNombre || '',
// 568:     items: (p.muebles || []).map(m => ({
// 569:       id: m.id,
// 570:       nombre: [m.codigo, m.nombre].filter(Boolean).join(' – '),
// 571:       centros: [],            // ← SIEMPRE VACÍO (pierde datos)
// 572:       hEst: Object.values(m.horas || {}).reduce((a,v)=>a+Number(v||0), 0),
// 573:       nota: '',               // ← SIEMPRE VACÍO (pierde datos)
// 574:     })),
// 575:     materiales: p.materiales || [],
// 576:     modulos: p.modulos || [],
// 577:   }));
// 578: })();
```
- **Problema crítico**: transforma `muebles → items` pero descarta `centros` y `nota` de cada ítem, y recalcula `hEst` sumando `m.horas`. No carga desde Supabase en absoluto.

**Líneas 495, 1375, 1467, 1494, 1513** — `syncTodosProyectos()`, `guardarProyecto()`, `confirmarRecibirInline()`, `toggleCriticoInline()`, `guardarMueblesLS()`
```js
const stored = JSON.parse(localStorage.getItem('proyectos') || '[]');
```
- Uso: re-lee localStorage para actualizar campos puntuales (nombre, muebles, mat.recibido, mat.critico) antes de re-guardar.

---

### planta2.html

**Sin lectura directa de localStorage('proyectos').**
Carga vía API:
```js
// 779: const _resProyectos = await apiGet('proyectos-activos');
// 781: const pList = _resProyectos.proyectos;
// 782: proyectos = pList || [];
```
- Usa el campo `p.items` de la respuesta para mostrar ítems en PASO 2.
- Usa `p.nombre` y `p.cliente` para mostrar en botones de proyecto.

---

### stock-placas.html

**No usa localStorage('proyectos').** Usa llaves propias: `LS_FORMATS`, `LS_HISTORIAL`, `LS_REMITO_BORRADOR`, `LS_REMITOS_HIST`, `LS_TAMANOS`, `LS_ESPESORES`. Sin referencia a proyectos.

---

## 2. ESCRITURAS de localStorage.setItem('proyectos', ...)

| Archivo | Línea | Función | Qué escribe |
|---------|-------|---------|-------------|
| nuevo-proyecto.html | 891 | `guardar()` | Lista completa: lee existente, push nuevo proyecto, guarda todo. |
| nuevo-proyecto.html | 920 | fetch callback | Sobreescribe con array fresco de Supabase. |
| materiales.html | 276 | fetch callback init | Sobreescribe con array fresco de Supabase. |
| materiales.html | 506 | `confirmarRecepcion()` | PROYECTOS con `mat.recibido` incrementado. |
| tercerizados.html | (612) | fetch callback init | Sobreescribe con array fresco de Supabase. |
| despacho.html | 255 | fetch callback init | Sobreescribe con array fresco de Supabase. |
| despacho.html | 571 | `guardarDespacho()` | PROYECTOS con módulos marcados `despachado:true`. |
| admin.html | 1383 | `guardarProyecto()` | stored[idx].nombre, obra, clienteNombre, muebles actualizados. |
| admin.html | 1479 | `confirmarRecibirInline()` | stored[idx].muebles con mat.recibido y semaforo actualizados. |
| admin.html | 1505 | `toggleCriticoInline()` | stored[idx].muebles con mat.critico toggled. |
| admin.html | 1515 | `guardarMueblesLS()` | stored[idx].muebles reemplazado. |

---

## 3. ESTRUCTURA del objeto proyecto

```typescript
interface Mueble {
  id: string;           // 'mf_0', 'mf_1', ... (índice del array original de Zoho)
  codigo: string;       // 'MF01', 'C01', etc.
  nombre: string;       // nombre del mueble/ítem
  cant: number;         // cantidad de unidades
  flujos: string[];     // ['tapiceria', 'herreria', 'lustre', 'electricidad', 'madera_maciza']
  hrsExtra: {
    tapiceria: number;
    herreria: number;
    lustre: number;
    electricidad: number;
    madera_maciza: number;
  };
  placas: number;       // número de placas para CNC
  dif: number;          // factor de dificultad (1–4, base 2)
  horas: {             // horas estimadas por centro, calculadas en nuevo-proyecto.html
    corte: number;
    enchapado: number;
    armado: number;
    revision: number;
    empaquetado: number;
  };
  mats: MaterialMueble[]; // materiales asignados a este mueble (puede estar ausente)
  semaforo?: 'rojo' | 'amarillo' | 'verde'; // calculado en admin.html confirmarRecibirInline
  materialesOk?: boolean; // flag calculado en materiales.html
  odfId?: string;         // ID de la factura de Zoho de origen
}

interface MaterialMueble {
  id: string;             // 'mat_' + timestamp
  nombre: string;
  sku?: string;           // SKU de Zoho
  unidad: string;         // 'planchas', 'unidades', 'metros', etc.
  requerido: number;
  recibido: number;       // acumulado por materiales.html / admin.html inline
  soOrigen?: string;      // número de SO origen
  muebleId?: string;
  critico?: boolean;      // bloquea producción si no está completo
  manual?: boolean;       // fue recibido manualmente en admin.html
}

interface MaterialProyecto {
  // usado en materiales.html (capa flat de materiales a nivel proyecto)
  id: string;
  muebleId: string;
  nombre: string;
  unidad: string;
  requerido: number;
  recibido: number;
}

interface Modulo {
  id: string;
  muebleId?: string;
  codigo: string;
  nombre: string;
  bulto: string | null;          // 'Bulto 1', etc. — null hasta despacho
  despachado: boolean;
  despachado_en?: string;        // ISO date, seteado por despacho.html
  despId?: string;               // ID del registro de despacho
}

interface SOCargada {
  numero: string;   // 'SO-1234'
  count: number;
}

interface Proyecto {
  id: string;              // 'pr_' + Date.now()  (ej: 'pr_1704067200000')
  numero: string;          // número ODF/SO de Zoho  (ej: 'ODF-2385', 'SO-01879')
  obra: string;            // nombre de la obra      (ej: 'MON BRAVA 301')
  clienteNombre: string;   // nombre del cliente
  fechaInicio: string;     // ISO date 'YYYY-MM-DD'
  fechaEntrega: string;    // ISO date 'YYYY-MM-DD'
  notas: string;
  estado: 'en_produccion' | 'entregado' | 'pausado';
  muebles: Mueble[];
  materiales: MaterialProyecto[];  // capa flat, usada por materiales.html
  sosCargadas: SOCargada[];
  modulos: Modulo[];
  creadoEn: number;        // Date.now() timestamp
}
```

**Campos derivados que admin.html calcula al cargar (NO guardados en localStorage como tales):**
```typescript
// admin.html transforma muebles → items para uso interno:
interface ItemAdmin {
  id: string;         // = mueble.id
  nombre: string;     // [mueble.codigo, mueble.nombre].join(' – ')
  centros: string[];  // SIEMPRE [] tras carga (dato perdido)
  hEst: number;       // sum(Object.values(mueble.horas))
  nota: string;       // SIEMPRE '' tras carga (dato perdido)
}
```

---

## 4. MAPA POR MÓDULO

### admin.html
- **Lee**: localStorage init + releer en cada inline-edit
- **Escribe**: modificaciones de nombre/clienteNombre/muebles/mat.recibido/mat.critico/semaforo
- **Sync a Supabase**: via `syncProyectoSupabase()` → acción `sync-proyecto` (¡LOSSY — solo 4 campos!)
  o via `guardar-proyecto` si pasó por nuevo-proyecto.html
- **Crítico**: transforma el array al cargar, perdiendo `centros` e `hEst` real de los ítems
- **No carga desde Supabase** — usa localStorage o seed hardcoded

### planta2.html
- **Lee**: API `proyectos-activos` → SELECT * FROM proyectos_cache WHERE activo=true
- **No escribe** localStorage('proyectos') nunca
- **Usa**: `p.items` (campo JSONB raw de proyectos_cache), `p.nombre`, `p.cliente`
- **Registra trabajo**: guarda `proyecto_id` y `item_id` como TEXT en `registros_trabajo`

### nuevo-proyecto.html
- **Lee**: localStorage para `filtrarODFs` (deduplicar ODFs ya cargadas)
- **Escribe**: push del proyecto nuevo a localStorage, luego POST a `guardar-proyecto`
- **Sync completo**: envía todos los campos vía `guardar-proyecto` (no lossy)

### materiales.html
- **Lee**: localStorage init + fetch fresco de Supabase al cargar
- **Escribe**: `mat.recibido` actualizado tras cada recepción de material
- **Sync a Supabase**: POST a `guardar-proyecto` para cada proyecto afectado + `guardar-recepcion`

### tercerizados.html
- **Lee**: `_PROYECTOS` para dropdown de muebles en modal Nueva Partida
- **No escribe** localStorage('proyectos')
- **Solo consulta** muebles.flujos para filtrar por tipo (tap/lus)

### despacho.html
- **Lee**: localStorage init + fetch fresco de Supabase al cargar
- **Escribe**: `modulo.despachado`, `bulto`, `despachado_en`, `despId` en los módulos del proyecto
- **Sync a Supabase**: `guardar-despacho` para el registro de despacho (proyectos en sí no se re-sincronizan)

### stock-placas.html
- **No usa** localStorage('proyectos') en absoluto. Independiente.

---

## 5. ESTADO ACTUAL de proyectos_cache en Supabase

### Archivos SQL encontrados en el repo
- `/schema-migration.sql` — archivo generado en esta misma sesión, aún **no ejecutado en Supabase**

### Columnas inferidas del código

**Columnas originales** (inferidas del endpoint `sync-proyecto` y código original):
| Columna | Tipo | Fuente |
|---------|------|--------|
| `id` | TEXT PRIMARY KEY | set por `sync-proyecto` (line 285) |
| `nombre` | TEXT | `sync-proyecto` line 285 |
| `cliente` | TEXT | `sync-proyecto` line 285 |
| `items` | JSONB | `sync-proyecto` line 285 |
| `activo` | BOOLEAN | `sync-proyecto` DEFAULT true |
| `sincronizado_at` | TIMESTAMPTZ | `sync-proyecto` DEFAULT NOW() |

**Columnas AGREGADAS en schema-migration.sql** (puede que no estén en Supabase todavía):
| Columna | Tipo | Fuente |
|---------|------|--------|
| `numero` | TEXT | `guardar-proyecto` |
| `obra` | TEXT | `guardar-proyecto` |
| `cliente_nombre` | TEXT | `guardar-proyecto` |
| `fecha_inicio` | TEXT | `guardar-proyecto` |
| `fecha_entrega` | TEXT | `guardar-proyecto` |
| `notas` | TEXT | `guardar-proyecto` |
| `estado` | TEXT DEFAULT 'en_produccion' | `guardar-proyecto` |
| `muebles` | JSONB DEFAULT '[]' | `guardar-proyecto` |
| `materiales` | JSONB DEFAULT '[]' | `guardar-proyecto` |
| `sos_cargadas` | JSONB DEFAULT '[]' | `guardar-proyecto` |
| `modulos` | JSONB DEFAULT '[]' | `guardar-proyecto` |
| `creado_en` | BIGINT | `guardar-proyecto` |

### Gaps entre proyectos_cache y estructura completa

| Campo en Proyecto | En proyectos_cache | Gap |
|-------------------|-------------------|-----|
| `id` | ✓ `id` TEXT PK | — |
| `numero` | ✓ `numero` (si schema-migration corrió) | Verificar |
| `obra` | ✓ `obra` (si schema-migration corrió) | Verificar |
| `clienteNombre` | `cliente` + `cliente_nombre` (ambos) | Duplicado |
| `fechaInicio` | `fecha_inicio` TEXT | Debería ser DATE |
| `fechaEntrega` | `fecha_entrega` TEXT | Debería ser DATE |
| `notas` | ✓ `notas` | — |
| `estado` | ✓ `estado` | — |
| `muebles[]` | `muebles` JSONB + `items` JSONB (copia) | Duplicado |
| `materiales[]` | `materiales` JSONB | — |
| `sosCargadas[]` | `sos_cargadas` JSONB | — |
| `modulos[]` | `modulos` JSONB | — |
| `creadoEn` | `creado_en` BIGINT | — |

**Campos nunca escritos a proyectos_cache** (solo en localStorage):
- `Mueble.semaforo` — calculado por admin.html
- `Mueble.materialesOk` — calculado por materiales.html
- `Mueble.mats[].manual` — flag de recepción manual

---

## 6. BOTÓN DE SYNC MANUAL en admin.html

### Ubicación del botón
**Línea 867** — dentro de `renderProyectos()`:
```js
`<button class="btn btn-ghost btn-sm" onclick="syncTodosProyectos()"
  title="Sincroniza todos los proyectos de localStorage a Supabase para que aparezcan en Planta v2">
  ↑ Sincronizar todos a planta
</button>`
```

### Función `syncTodosProyectos()` — líneas 493–510
```js
async function syncTodosProyectos() {
  const todos = JSON.parse(localStorage.getItem('proyectos') || '[]');
  // ...
  for (const p of todos) {
    await syncProyectoSupabase(p);
  }
}
```

### Función `syncProyectoSupabase(proyecto)` — líneas 471–491
```js
const body = {
  id:     proyecto.id || proyecto.numero,
  nombre: proyecto.nombre || proyecto.obra,
  cliente:proyecto.cliente || proyecto.clienteNombre || '',
  items:  proyecto.muebles || proyecto.items || []
};
// POST /api/tiempos?action=sync-proyecto
```

### Acción `sync-proyecto` en api/tiempos.js — líneas 281–290
```js
supabase.from('proyectos_cache').upsert({
  id, nombre, cliente, items,
  activo: true,
  sincronizado_at: new Date().toISOString()
}, { onConflict: 'id' })
```

### Campos que copia vs campos que NO copia

| Campo | sync-proyecto | guardar-proyecto |
|-------|:---:|:---:|
| `id` | ✓ | ✓ |
| `nombre` | ✓ | ✓ (como `nombre` + `obra`) |
| `cliente` | ✓ | ✓ (como `cliente` + `cliente_nombre`) |
| `items` / `muebles` | ✓ | ✓ (ambos campos) |
| `numero` | ✗ **FALTA** | ✓ |
| `obra` | ✗ **FALTA** | ✓ |
| `cliente_nombre` | ✗ **FALTA** | ✓ |
| `fecha_inicio` | ✗ **FALTA** | ✓ |
| `fecha_entrega` | ✗ **FALTA** | ✓ |
| `notas` | ✗ **FALTA** | ✓ |
| `estado` | ✗ **FALTA** | ✓ |
| `materiales` | ✗ **FALTA** | ✓ |
| `sos_cargadas` | ✗ **FALTA** | ✓ |
| `modulos` | ✗ **FALTA** | ✓ |
| `creado_en` | ✗ **FALTA** | ✓ |

**Conclusión**: `sync-proyecto` es el camino legacy y lossy. Solo debe usarse `guardar-proyecto`.
`syncProyectoSupabase()` en admin.html también llama a `sync-proyecto`, no a `guardar-proyecto`.

---

## 7. TABLAS RELACIONADAS

### registros_trabajo
```sql
-- Definición en api/tiempos.js (comentario líneas 17–32)
id            UUID DEFAULT gen_random_uuid() PRIMARY KEY
empleado_id   TEXT NOT NULL   -- valor: empleados.id (UUID como string)
jornada_id    UUID            -- FK no declarada a jornadas.id
proyecto_id   TEXT            -- valor: 'pr_' + timestamp (ej: 'pr_1704067200000')
proyecto_nombre TEXT          -- desnormalizado, copia del nombre
item_id       TEXT            -- valor: 'mf_0', 'mf_1', ... o código del ítem
item_nombre   TEXT            -- desnormalizado, copia del nombre
centro        TEXT            -- valor libre: 'Corte CNC', 'Armado', etc.
inicio        TIMESTAMPTZ NOT NULL
fin           TIMESTAMPTZ
estado        TEXT DEFAULT 'activo'   -- activo|pausado|finalizado|retrabajo
es_retrabajo  BOOLEAN DEFAULT false
motivo_retrabajo TEXT
creado_at     TIMESTAMPTZ DEFAULT NOW()
```

**Tipo de FK**: `proyecto_id TEXT` — coincide con `proyectos_cache.id TEXT`. No hay FK declarada.
**Tipo de FK**: `item_id TEXT` — coincide con `mueble.id` dentro del JSONB `proyectos_cache.items`.

### registros_cnc
```sql
-- Definición en api/tiempos.js (comentario líneas 42–51)
id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY
registro_trabajo_id  UUID   -- FK a registros_trabajo.id (UUID)
empleado_id          TEXT
placa_numero         INTEGER
inicio               TIMESTAMPTZ
fin                  TIMESTAMPTZ
resultado            TEXT   -- ok|error|saltada
creado_at            TIMESTAMPTZ DEFAULT NOW()
```

**Referencia a proyecto**: indirecta vía `registro_trabajo_id → registros_trabajo.proyecto_id`.

### jornadas
```sql
-- Definición en api/tiempos.js (comentario líneas 5–15)
id               UUID DEFAULT gen_random_uuid() PRIMARY KEY
empleado_id      TEXT NOT NULL
fecha            DATE NOT NULL
entrada          TIMESTAMPTZ NOT NULL
salida           TIMESTAMPTZ
tarde            BOOLEAN DEFAULT false
descanso_minutos INTEGER DEFAULT 30
descanso_editado BOOLEAN DEFAULT false
editado_por      TEXT
UNIQUE(empleado_id, fecha)
```

**Sin referencia a proyectos**: las jornadas solo trackean presencia del empleado.

### Implicancias para la migración de PKs

| Tabla | Campo | Tipo actual | Compatibilidad post-migración |
|-------|-------|-------------|-------------------------------|
| `registros_trabajo` | `proyecto_id` | TEXT | Compatible: `proyectos_cache.id` seguirá siendo TEXT |
| `registros_trabajo` | `item_id` | TEXT | Compatible: los item IDs seguirán siendo `mf_0`, `mf_1`, etc. |
| `registros_cnc` | (indirecto) | — | Sin impacto |
| `jornadas` | (sin ref) | — | Sin impacto |

**Conclusión**: No se necesita migrar datos en `registros_trabajo` ni `registros_cnc`. Los IDs de proyectos e ítems son strings texto que seguirán siendo los mismos.
