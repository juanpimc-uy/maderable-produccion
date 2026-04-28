# Lote 4.2 — Investigación: unificación planta + oficina + descanso

---

## PARTE A — Endpoints que afectan `registros_trabajo` y `jornadas`

### 1. Lista completa de endpoints relevantes

---

#### `entrada` — POST — Abre jornada del día

**Body:** `{ empleado_id }`

**Qué hace:** Crea o actualiza (`upsert`) una fila en `jornadas` con
`entrada = NOW()`. Calcula si el empleado llegó tarde comparando con su
`horario_entrada` + 10 minutos de gracia. Campo `salida` queda NULL.

```js
if (action === 'entrada' && req.method === 'POST') {
  const { empleado_id } = body;
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();

  const { data: emp } = await supabase
    .from('empleados').select('horario_entrada').eq('id', empleado_id).single();

  const [h, m] = (emp?.horario_entrada || '08:00').split(':');
  const esperado = new Date();
  esperado.setHours(parseInt(h), parseInt(m), 0, 0);
  const tarde = new Date() > new Date(esperado.getTime() + 10 * 60000);

  const { data, error } = await supabase
    .from('jornadas')
    .upsert({ empleado_id, fecha: hoy, entrada: ahora, tarde }, { onConflict: 'empleado_id,fecha' })
    .select().single();
  if (error) throw error;
  return ok({ jornada: data });
}
```

---

#### `salida` — POST — Cierra jornada del día

**Body:** `{ empleado_id, jornada_id }`

**Qué hace:**
1. Cierra cualquier registro_trabajo activo del empleado → `estado = 'pausado'`, `fin = NOW()`
2. Actualiza la jornada → `salida = NOW()`

```js
if (action === 'salida' && req.method === 'POST') {
  const { empleado_id, jornada_id } = body;
  const ahora = new Date().toISOString();

  await supabase.from('registros_trabajo')
    .update({ fin: ahora, estado: 'pausado' })
    .eq('empleado_id', empleado_id).eq('estado', 'activo');

  const { data } = await supabase
    .from('jornadas').update({ salida: ahora }).eq('id', jornada_id).select().single();
  return ok({ jornada: data });
}
```

---

#### `iniciar-tarea` — POST — Inicia tarea de operario (CAMBIAR O INICIAR)

**Body:** `{ empleado_id, jornada_id, proyecto_id, proyecto_nombre, item_id, item_nombre, centro }`

**Qué hace:**
1. Cierra cualquier registro activo del empleado → `estado = 'pausado'`, `fin = NOW()`
2. Inserta nueva fila en `registros_trabajo` con `estado = 'activo'`

No hay un endpoint separado para "cambiar tarea" y "iniciar tarea" — es el mismo.
Al llamar `iniciar-tarea` con una tarea ya activa, la tarea anterior queda
con `estado = 'pausado'` (no `'finalizado'`). Esto es intencional para el
flujo de planta: el operario puede cambiar de tarea sin ir al checklist.

```js
if (action === 'iniciar-tarea' && req.method === 'POST') {
  const { empleado_id, jornada_id, proyecto_id, proyecto_nombre,
          item_id, item_nombre, centro } = body;
  const ahora = new Date().toISOString();

  await supabase.from('registros_trabajo')
    .update({ fin: ahora, estado: 'pausado' })
    .eq('empleado_id', empleado_id).eq('estado', 'activo');

  const { data, error } = await supabase.from('registros_trabajo')
    .insert({ empleado_id, jornada_id, proyecto_id, proyecto_nombre,
              item_id, item_nombre, centro, inicio: ahora, estado: 'activo' })
    .select().single();
  if (error) throw error;
  return ok({ registro: data });
}
```

---

#### `finalizar-tarea` — POST — Finaliza tarea con checklist (o retrabajo)

**Body:** `{ registro_id, empleado_id, respuestas_checklist, es_retrabajo, motivo_retrabajo }`

**Qué hace:**
- Actualiza el registro → `fin = NOW()`, `estado = 'finalizado'` o `'retrabajo'`
- Si hay `respuestas_checklist`, inserta en `checklist_respuestas`

No llama a `iniciar-tarea` — el operario queda sin tarea activa.

```js
if (action === 'finalizar-tarea' && req.method === 'POST') {
  const { registro_id, empleado_id, respuestas_checklist,
          es_retrabajo, motivo_retrabajo } = body;
  const ahora = new Date().toISOString();

  const { data } = await supabase.from('registros_trabajo')
    .update({ fin: ahora,
              estado: es_retrabajo ? 'retrabajo' : 'finalizado',
              es_retrabajo: es_retrabajo || false,
              motivo_retrabajo: motivo_retrabajo || null })
    .eq('id', registro_id).select().single();

  if (respuestas_checklist && Object.keys(respuestas_checklist).length > 0) {
    await supabase.from('checklist_respuestas').insert({
      registro_trabajo_id: registro_id, empleado_id, respuestas: respuestas_checklist,
    });
  }
  return ok({ registro: data });
}
```

---

#### `editar-jornada` — PATCH — Edición manual (supervisor)

**Body:** `{ jornada_id, entrada, salida, descanso_minutos, editor_id }`

**Qué hace:** Actualiza campos de la jornada incluyendo `descanso_minutos`.
Marca `descanso_editado = true` y registra quién editó.

```js
if (action === 'editar-jornada' && req.method === 'PATCH') {
  const { jornada_id, entrada, salida, descanso_minutos, editor_id } = body;
  const { data } = await supabase.from('jornadas')
    .update({ entrada, salida, descanso_minutos, descanso_editado: true, editado_por: editor_id })
    .eq('id', jornada_id).select().single();
  return ok({ jornada: data });
}
```

---

#### `tiempo-activo` — GET — Timer activo de un empleado (oficina)

**Params:** `?empleado_id=`

**Qué hace:** Devuelve el único `registros_trabajo` con `estado = 'activo'`
del empleado. Incluye `item_id, item_nombre` (agregado en Lote 4.1).

```js
if (action === 'tiempo-activo' && req.method === 'GET') {
  const empleado_id = url.searchParams.get('empleado_id');
  if (!empleado_id) return err('empleado_id requerido', 400);
  const { data } = await supabase
    .from('registros_trabajo')
    .select('id, proyecto_id, proyecto_nombre, item_id, item_nombre, centro, inicio')
    .eq('empleado_id', empleado_id)
    .eq('estado', 'activo')
    .maybeSingle();
  return ok({ activo: data || null });
}
```

---

#### `jornada-hoy` — GET — Lee jornada activa (no modifica tablas)

**Params:** `?empleado_id=`

**Qué hace:** Solo lectura — devuelve la jornada de hoy del empleado.

---

#### `registros-hoy` — GET — Registros del día (solo lectura)

**Params:** `?empleado_id=`

**Qué hace:** Solo lectura — devuelve todos los `registros_trabajo` de hoy del empleado.

---

#### `dashboard-live` — GET — Dashboard en tiempo real (solo lectura)

**Qué hace:** Solo lectura — une jornadas + registros activos + empleados + CNC activo.

---

#### `cnc-placa` — POST — Registro CNC (no afecta registros_trabajo)

Afecta solo `registros_cnc`. No incluido en detalle.

---

### 2. Endpoints de descanso, pausa

**No existe ningún endpoint de descanso o pausa** en la API actual.

El único rastro de "descanso" en planta es:
- La jornada tiene `descanso_minutos INTEGER DEFAULT 30` — es un campo fijo
  que se resta en el cálculo de horas netas al mostrar la pantalla de salida.
  No existe ningún registro en `registros_trabajo` que represente un descanso.
- `editar-jornada` permite editar `descanso_minutos` manualmente.
- En `pantalla-salida` HTML se muestra "Descanso descontado: 30 min" hardcodeado
  (no viene del servidor).

---

## PARTE B — Estructura de las tablas

### 3. Schema de `jornadas` (del comentario en api/tiempos.js)

```sql
CREATE TABLE IF NOT EXISTS jornadas (
  id                UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id       TEXT         NOT NULL,
  fecha             DATE         NOT NULL,
  entrada           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  salida            TIMESTAMPTZ,              -- NULL hasta salida del día
  tarde             BOOLEAN      DEFAULT false,
  descanso_minutos  INTEGER      DEFAULT 30,
  descanso_editado  BOOLEAN      DEFAULT false,
  editado_por       TEXT,
  UNIQUE(empleado_id, fecha)
);
```

### Schema de `registros_trabajo`

```sql
CREATE TABLE IF NOT EXISTS registros_trabajo (
  id               UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id      TEXT         NOT NULL,
  jornada_id       UUID,                      -- NULL para registros de oficina
  proyecto_id      TEXT,
  proyecto_nombre  TEXT,
  item_id          TEXT,                      -- NULL si el centro no requiere item
  item_nombre      TEXT,
  centro           TEXT,
  inicio           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  fin              TIMESTAMPTZ,               -- NULL mientras estado = 'activo'
  estado           TEXT         DEFAULT 'activo',
                                              -- activo | pausado | finalizado | retrabajo
  es_retrabajo     BOOLEAN      DEFAULT false,
  motivo_retrabajo TEXT,
  creado_at        TIMESTAMPTZ  DEFAULT NOW()
);
```

### Schema de `centros_virtuales`

```sql
CREATE TABLE IF NOT EXISTS centros_virtuales (
  id         UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre     TEXT         NOT NULL UNIQUE,
  activo     BOOLEAN      DEFAULT true,
  creado_en  TIMESTAMPTZ  DEFAULT NOW()
);
```

---

### 4. Relación entre `jornadas` y `registros_trabajo`

`registros_trabajo.jornada_id` es FK nullable hacia `jornadas.id`.

- **Operarios**: `jornada_id` siempre viene del `jornada.id` obtenido en el login.
  Un registro de trabajo pertenece a una jornada del día.
- **Oficina**: `jornada_id = NULL`. No tienen jornada — este es el diferenciador
  actual entre un registro de operario y uno de oficina.

---

### 5. ¿Hay campo que distinga "tarea de trabajo" vs "descanso"?

**No.** No existe ninguna columna en `registros_trabajo` que distinga
descanso de trabajo. Los valores posibles del campo `estado` son:
`activo`, `pausado`, `finalizado`, `retrabajo`.

El descanso no existe como registro — solo existe como `descanso_minutos`
en la jornada (un número que se resta al total).

---

### 6. Filas de ejemplo de `registros_trabajo` (construidas desde el schema)

No tengo acceso directo a Supabase para hacer SELECT, pero el patrón de
datos inferido del código es:

```
-- Registro de operario activo:
id: "uuid-1"  empleado_id: "emp-abc"  jornada_id: "jor-xyz"
proyecto_id: "proj-001"  proyecto_nombre: "P-001 · OBRA CLIENTE"
item_id: "mf_0"  item_nombre: "MF01 · CARRITO con patas"
centro: "Armado"  inicio: "2026-04-28T08:30:00Z"  fin: NULL
estado: "activo"  es_retrabajo: false

-- Registro de operario finalizado (cambio de tarea):
id: "uuid-2"  jornada_id: "jor-xyz"
estado: "pausado"  fin: "2026-04-28T10:15:00Z"

-- Registro de oficina:
id: "uuid-3"  empleado_id: "emp-ofic"  jornada_id: NULL
proyecto_id: "proj-001"  centro: "Shop Drawing"
item_id: "mf_0"  item_nombre: "MF01 · CARRITO con patas"
inicio: "2026-04-28T09:00:00Z"  fin: NULL  estado: "activo"

-- Registro de oficina sin item:
id: "uuid-4"  empleado_id: "emp-ofic"  jornada_id: NULL
proyecto_id: "proj-002"  centro: "Coordinacion"
item_id: NULL  item_nombre: NULL
estado: "finalizado"  fin: "2026-04-28T11:00:00Z"
```

---

### 7. Filas de ejemplo de `jornadas`

```
-- Jornada abierta (sin salida):
id: "jor-xyz"  empleado_id: "emp-abc"  fecha: "2026-04-28"
entrada: "2026-04-28T08:05:00Z"  salida: NULL
tarde: false  descanso_minutos: 30  descanso_editado: false

-- Jornada cerrada:
id: "jor-abc"  empleado_id: "emp-def"  fecha: "2026-04-27"
entrada: "2026-04-27T08:00:00Z"  salida: "2026-04-27T17:00:00Z"
tarde: false  descanso_minutos: 30  descanso_editado: false

-- Jornada con descanso editado:
id: "jor-ghi"  empleado_id: "emp-ghi"  fecha: "2026-04-26"
entrada: "2026-04-26T08:45:00Z"  salida: "2026-04-26T17:30:00Z"
tarde: true  descanso_minutos: 45  descanso_editado: true  editado_por: "emp-admin"
```

---

## PARTE C — Lógica del frontend planta2.html

### 8. Handlers de acciones clave

---

**"▶ INICIAR / CAMBIAR TAREA"** (onclick):
```js
onclick="ir('pantalla-tarea');initTarea()"
```
`initTarea()` limpia la selección y renderiza la lista de proyectos.
Después el operario sigue el wizard: proyecto → item → centro → confirmar.

---

**"CONFIRMAR TAREA"** (wizard, pantalla-tarea):
```js
async function confirmarTarea() {
  if (!proyectoSel || !itemSel || !centroSel) return;
  const btn = document.getElementById('btn-confirmar-tarea');
  btn.textContent = 'Iniciando…'; btn.disabled = true;
  try {
    const { registro } = await apiPost('iniciar-tarea', {
      empleado_id:     empleadoActual.id,
      jornada_id:      jornada.id,
      proyecto_id:     proyectoSel.id,
      proyecto_nombre: proyectoSel.nombre,
      item_id:         itemSel.id,
      item_nombre:     itemSel.nombre,
      centro:          centroSel,
    });
    registroActivo = registro;
    // guarda centro como reciente en localStorage
    if (centroSel.toUpperCase().includes('CNC')) {
      initCNC(); ir('pantalla-cnc');
    } else {
      toast('Tarea iniciada ✓', 'var(--green)');
      renderMenuTarea(); ir('pantalla-menu');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'var(--red)');
    btn.disabled = false;
  } finally {
    btn.textContent = 'CONFIRMAR TAREA';
    btn.disabled = false;
  }
}
```

---

**"⏹ FINALIZAR TAREA ACTUAL"** (onclick):
```js
onclick="ir('pantalla-finalizar');initFinalizar()"
```
`initFinalizar()` muestra el checklist. El operario completa el checklist
y llama `finalizarOk()`:
```js
async function finalizarOk() {
  await apiPost('finalizar-tarea', {
    registro_id: registroActivo.id,
    empleado_id: empleadoActual.id,
    respuestas_checklist: respuestas,
    es_retrabajo: false,
  });
  registroActivo = null;
  renderMenuTarea(); ir('pantalla-menu');
}
```
O si marca retrabajo, `confirmarRetrabajo()`:
```js
async function confirmarRetrabajo() {
  await apiPost('finalizar-tarea', {
    registro_id: registroActivo.id,
    empleado_id: empleadoActual.id,
    respuestas_checklist: {},
    es_retrabajo: true,
    motivo_retrabajo: motivo || null,
  });
  registroActivo = null;
}
```

---

**"⬚ SALIDA DEL DÍA"** (onclick):
```js
onclick="ir('pantalla-salida');initSalida()"
```
`initSalida()` carga `registros-hoy` y muestra el resumen.
`confirmarSalida()` llama al endpoint:
```js
async function confirmarSalida() {
  await apiPost('salida', { empleado_id: empleadoActual.id, jornada_id: jornada.id });
  // reset estado, ir a pantalla-login
}
```

---

**"← Cambiar empleado"**:
```js
function cambiarEmpleado() {
  empleadoActual = null;
  jornada        = null;
  registroActivo = null;
  clearInterval(_intervaloReloj);
  clearInterval(_intervaloTimers);
  _pin = ''; renderPin();
  document.getElementById('sel-empleado').value = '';
  document.getElementById('login-error').textContent = '';
  ir('pantalla-login');
}
```
Solo limpia estado local, no llama ningún endpoint. El registro activo
queda abierto en Supabase hasta que otro operario o `iniciar-tarea` lo cierre.

---

### 9. ¿Qué pasa al presionar "INICIAR / CAMBIAR TAREA" con tarea activa?

No hay confirmación ni diálogo previo. El botón siempre está habilitado.
Al llegar a `confirmarTarea()` y llamar `iniciar-tarea`:
- El servidor cierra el registro activo con `estado = 'pausado'` (no finalizado)
- Se inserta el nuevo registro con `estado = 'activo'`

**El item anterior se cierra como "pausado"**, no como "finalizado". Esto
implica que el tiempo de ese registro existe en DB pero la tarea no pasó
por checklist — es un cambio directo de tarea.

---

### 10. ¿Existe el concepto de "descanso" en planta hoy?

**No existe como registro.** Hoy el descanso es:
- Un campo `descanso_minutos INTEGER DEFAULT 30` en la jornada
- Se resta fijo al calcular el tiempo neto en la pantalla de salida
- Es editable retroactivamente por supervisor vía `editar-jornada`

No hay botón de "iniciar descanso", no hay registro de inicio/fin de
descanso, no hay pausa. Se crea de cero.

---

## PARTE D — Decisiones técnicas

### a) ¿Mergear o mantener separados los endpoints de inicio de tarea?

**Recomendación: MANTENERLOS SEPARADOS.**

`iniciar-tarea` (operarios) y `iniciar-tiempo-oficina` (oficina) tienen
responsabilidades distintas:

| Aspecto | iniciar-tarea | iniciar-tiempo-oficina |
|---------|--------------|----------------------|
| Requiere jornada | Sí (`jornada_id`) | No |
| Cierra tarea anterior | Sí (override directo) | No (409 si hay activo) |
| Valida rol | No | Sí (oficina/admin) |
| Valida centro | No (texto libre) | Sí (tabla centros_virtuales) |
| Valida item | No (texto libre) | Sí (JSONB check) |
| Flujo | Wizard de 3 pasos | Modal de oficina |

Mergear en un solo endpoint requeriría bifurcar por rol dentro del
handler, mezclando lógica de jornada con lógica de centro virtual.
Una función helper compartida tampoco ayuda: la única lógica realmente
común es el INSERT en `registros_trabajo`, que son 5 líneas.

**Conviene: endpoints separados, sin helper.** Cada endpoint es
autosuficiente y fácil de leer.

---

### b) ¿Descanso como `centros_virtuales` o columna en `registros_trabajo`?

**Recomendación: centros_virtuales con bandera `es_descanso`.**

Razones:
1. Descanso es un **tipo de actividad** (como Shop Drawing, Coordinacion).
   Modelarlo como un centro es consistente con el esquema existente.
2. Permite reusar el mismo flujo de `iniciar-tiempo-oficina` /
   `detener-tiempo-oficina` sin modificar la tabla.
3. Agregar columna `es_descanso` a `registros_trabajo` requiere ALTER TABLE
   en producción y afecta a todos los registros históricos.
4. Los reportes pueden filtrar `centros_virtuales.es_descanso = true` para
   separar tiempo productivo de descanso.

Implementación: `ALTER TABLE centros_virtuales ADD COLUMN es_descanso BOOLEAN DEFAULT false`
+ INSERT del centro "Descanso" con `es_descanso = true`.

Consideración adicional: en planta el descanso NO es un registro de trabajo
(es `jornadas.descanso_minutos`). Para oficina conviene que sí lo sea,
porque oficina no tiene jornada. Son modelos distintos — no hay que
unificarlos.

---

### c) ¿Salida del día de oficina: mismo endpoint que planta o separado?

**Recomendación: SEPARADO.**

El endpoint `salida` de planta asume que el empleado tiene `jornada_id`:
cierra el registro activo con `estado = 'pausado'` y luego actualiza la
jornada. Oficina no tiene jornada — si llamara a `salida`, el UPDATE en
jornadas fallaría silenciosamente (no hay fila que actualizar) y el
registro quedaría en `estado = 'pausado'` en lugar de `'finalizado'`.

Para oficina la semántica correcta es: al "salir del día" se detiene el
timer activo (si hay uno) vía `detener-tiempo-oficina` (que ya existe).
No hace falta un endpoint de "salida de jornada" para oficina porque
oficina no tiene jornada. El equivalente es simplemente asegurarse de
que no queden timers activos abiertos.

Si en el futuro se quiere registrar la hora de entrada/salida de oficina,
eso sería una feature nueva independiente (Lote N).

---

## Resumen ejecutivo

| Tema | Estado actual | Observación para Lote 4.2 |
|------|--------------|--------------------------|
| Descanso en planta | `jornadas.descanso_minutos` fijo, no es registro | Crear de cero para oficina como centro virtual |
| Descanso en oficina | No existe | Nuevo: centro_virtual con `es_descanso = true` |
| Merge endpoints | No conviene | Mantener `iniciar-tarea` e `iniciar-tiempo-oficina` separados |
| Salida oficina | No existe | `detener-tiempo-oficina` es suficiente; no crear endpoint de jornada |
| `jornada_id = NULL` | Identificador de registros de oficina | No cambiar — es suficiente para distinguir |
