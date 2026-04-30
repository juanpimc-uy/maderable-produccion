# Lote 4.3.6 — Fix bloqueo persistente + cronómetro descanso

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `api/tiempos.js` | `metricas-dia` agrega `hueco_actual_minutos` al response |
| `admin.html` JS | `_timerActualizarEstado` usa `hueco_actual_minutos` para el bloqueo |
| `admin.html` JS | `_timerSetEstado` descanso-activo restaura `setInterval` de 1s |
| `admin.html` JS | `_timerBarActualizarDescanso` muestra cronómetro `HH:MM:SS` |

---

## Bug fix: bloqueo no se quitaba al finalizar tarea

### Causa

El frontend usaba `tiempo_no_clasificado_minutos` (acumulado total del día) para decidir si
mostrar el overlay de bloqueo:

```js
// ANTES (bug):
const noClas = json.totales?.tiempo_no_clasificado_minutos || 0;
_timerSetEstado(noClas >= _UMBRAL_BLOQUEO ? 'bloqueado' : 'jornada-sin-tarea');
```

Ese campo suma TODOS los huecos del día (entrada→primer registro, entre registros, y el trailing gap).
Si una persona acumuló 20 min sin clasificar antes de las 9:20 y luego trabajó toda la mañana,
al finalizar una tarea el acumulado seguía siendo ≥15min → bloqueo inmediato aunque llevara
0 segundos sin tarea.

### Fix

Nuevo campo `hueco_actual_minutos` en `metricas-dia`:

```js
// BACKEND: calculado después del loop de gaps
let hueco_actual_minutos = 0;
if (!tarea_activa && jornada) {
  // gap_start = fin del último registro (o entrada si no hay registros)
  hueco_actual_minutos = Math.max(0, Math.round((ahora - gap_start) / 60000));
}
```

El campo mide solo el gap vigente: desde el fin del último registro hasta ahora.
Si el empleado acaba de finalizar una tarea, `gap_start` = ahora → `hueco_actual_minutos` = 0.

```js
// FRONTEND (fix):
const huecoActual = json.totales?.hueco_actual_minutos || 0;
_timerSetEstado(huecoActual >= _UMBRAL_BLOQUEO ? 'bloqueado' : 'jornada-sin-tarea');
```

`tiempo_no_clasificado_minutos` se sigue usando solo en el panel expandible (fila "SIN CLASIFICAR"),
donde el acumulado del día sí es la información correcta.

### Escenarios verificados

| Situación | hueco_actual | Resultado |
|-----------|-------------|-----------|
| Sin marcar 20min desde entrada | 20 | BLOQUEO ✓ |
| Finalizó tarea hace 5 seg | 0 | SIN BLOQUEO ✓ (bug corregido) |
| 29min acumulados, pero recién finalizó | 0 | SIN BLOQUEO ✓ |
| En descanso activo | — (tarea_activa existe) | SIN BLOQUEO ✓ |
| En tarea activa | — (tarea_activa existe) | SIN BLOQUEO ✓ |

---

## UX: cronómetro restaurado en estado descanso

### Historial del cambio

- **Lote 4.3**: se agregó cronómetro en descanso.
- **Lote 4.3.2**: se quitó el cronómetro por pedido de "discreción" (no mostrar cuánto dura el descanso).
- **Lote 4.3.6**: se restaura por pedido contrario del usuario.

### Cambios

En `_timerSetEstado` rama `descanso-activo`:
- Restaurado `_timerInterval = setInterval(_timerBarActualizarDescanso, 1000)`

En `_timerBarActualizarDescanso`:
- Ahora calcula segundos desde `_timerRegistro.inicio` en tiempo real
- Formato: `MM:SS` (< 1h) o `HH:MM:SS` (≥ 1h) vía `_fmtHMS` existente
- Display: `"☕ Descanso · 00:08:32"`
- Si modalidad paga_30 y excedido: `"Descanso · 00:32:15 · ⚠ +2min"` (exceso en rojo #c00000)
- Al recargar página: el cronómetro retoma correctamente desde `tarea_activa.inicio`

---

## Cómo probar

### Bug del bloqueo

1. Marcar entrada
2. Esperar 16 min sin marcar nada → aparece overlay rojo ✓
3. Click "Iniciar tarea" desde overlay → seleccionar proyecto + centro → INICIAR
4. Trabajar 1 minuto
5. Click "Finalizar tarea"
6. **Verificar:** NO debe aparecer overlay rojo, aunque el panel diga "Sin clasificar: 16 min"
7. Esperar 16 min más sin marcar → overlay vuelve a aparecer ✓

### Cronómetro descanso

1. Con tarea activa → click "Descanso"
2. Barra cyan: "☕ Descanso · 00:00:01" y sube cada segundo ✓
3. Recargar página → cronómetro retoma con tiempo correcto desde `tarea_activa.inicio` ✓
4. Con modalidad `paga_30` y descanso > 30min: texto muestra "⚠ +Xmin" en rojo al lado del cronómetro ✓

---

## Lo que NO se modificó

- `planta2.html`
- Lógica de descanso, modalidad, jornadas huérfanas
- Endpoints v2 y resto de lógica del timer
- `tiempo_no_clasificado_minutos` (sigue en el panel expandible igual que antes)
