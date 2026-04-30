# Lote 4.3.4 — Investigación

## Problema 1 — Estado incorrecto antes de que metricas-dia responda

### Flujo actual de inicialización

```
initTimerBar()
  → bar.style.display = 'flex'      ← barra visible, _timerEstado = null
  → await _timerActualizarEstado()  ← fetch a metricas-dia (puede tardar 200-800ms)
      → _timerSetEstado('sin-jornada' | ...)
```

### Riesgo

Si el usuario hace click en la barra **durante** ese fetch inicial:

```js
function _timerBarClick(e) {
  if (_timerEstado === 'sin-jornada') _timerEntradaAbrir();
  else if (_timerEstado === 'jornada-sin-tarea' || _timerEstado === 'bloqueado') _timerModalAbrir();
}
```

`_timerEstado` es `null` → no entra en ninguna rama → no pasa nada (no-op).
**No rompe nada**, pero el click se pierde silenciosamente.

### Fix propuesto

Agregar estado inicial `'cargando'` en `initTimerBar()` antes del fetch.
En `_timerBarClick`, ignorar clicks si `_timerEstado === 'cargando'`.
Mostrar texto "Cargando…" en la barra durante ese estado.

---

## Problema 2 — Visibilidad del botón "Salida del día"

### Estado actual por estado

| Estado | `timer-btn-salida` visible |
|--------|---------------------------|
| `sin-jornada` | NO ✓ (correcto — no hay jornada) |
| `jornada-sin-tarea` | **SÍ** ✓ |
| `tarea-activa` | **SÍ** ✓ |
| `descanso-activo` | **SÍ** ✓ |
| `bloqueado` | **NO** ✗ — falta |

En `_timerSetEstado` para el estado `bloqueado`, se muestra el overlay pero **no** se hace visible `timer-btn-salida`. Si el usuario está bloqueado y quiere salir, solo tiene acceso al botón "▶ INICIAR TAREA" del overlay. No puede hacer salida sin iniciar una tarea primero.

### Fix propuesto

Agregar `document.getElementById('timer-btn-salida').style.display = '';` en la rama `bloqueado` de `_timerSetEstado`.

El botón "Salida" debería estar disponible en todos los estados donde la jornada está abierta:
`jornada-sin-tarea`, `tarea-activa`, `descanso-activo`, `bloqueado`.

---

## Problema 3 — Jornadas huérfanas (días anteriores con salida=NULL)

### Situación actual

No existe ninguna lógica que detecte jornadas de días anteriores con `salida = NULL`.

Si un empleado cierra la laptop sin hacer salida, la jornada queda abierta indefinidamente.
Al día siguiente, `metricas-dia` consulta por `fecha = hoy` → devuelve `jornada: null` → estado `sin-jornada`.
Las horas trabajadas ayer quedan sin cerrar.

### Detección necesaria

Query: `SELECT id, fecha, entrada FROM jornadas WHERE empleado_id = $1 AND salida IS NULL AND fecha < $hoy ORDER BY fecha DESC`

### Campos útiles para el modal de cierre

- `fecha` — mostrar "Jornada del dd/mm/yyyy"
- `entrada` — hora de entrada del día
- último `fin` de `registros_trabajo` de esa jornada → estimar hora de salida
- conteo de registros → mostrar resumen

### Comportamiento propuesto

1. Al iniciar la barra, si hay jornadas huérfanas, mostrar badge/indicador en la barra
2. Click en el badge abre un modal con lista de jornadas sin cerrar
3. Por cada jornada: botón "Cerrar con hora estimada" que llama a `salida-del-dia` con `jornada_id` explícito
4. Backend `jornadas-abiertas-anteriores` (GET) devuelve lista con metadatos
5. Backend `salida-del-dia` ya existe — necesita soporte de `jornada_id` explícito, o nuevo endpoint `cerrar-jornada-huerfana`

---

## Resumen de cambios necesarios

| # | Dónde | Qué |
|---|-------|-----|
| 1 | `admin.html` — `initTimerBar` | Estado inicial `'cargando'` antes del fetch |
| 2 | `admin.html` — `_timerSetEstado` | Agregar `timer-btn-salida` en rama `bloqueado` |
| 3 | `api/tiempos.js` | Nuevo endpoint `GET jornadas-abiertas-anteriores` |
| 4 | `api/tiempos.js` | Nuevo endpoint `POST cerrar-jornada-huerfana` |
| 5 | `admin.html` | Badge contador de jornadas huérfanas en timer bar |
| 6 | `admin.html` | Modal de jornadas huérfanas con botón de cierre por jornada |
