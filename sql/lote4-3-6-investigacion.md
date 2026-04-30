# Lote 4.3.6 — Investigación

## A) Cálculo de `tiempo_no_clasificado_minutos` en metricas-dia

```js
// tiempo_no_clasificado: gaps entre registros (ordenados por inicio)
let tiempo_no_clasificado_minutos = 0;
let gap_start = new Date(jornada.entrada);
for (const reg of regs) {
  const reg_inicio = new Date(reg.inicio);
  if (reg_inicio > gap_start) {
    tiempo_no_clasificado_minutos += Math.round((reg_inicio - gap_start) / 60000);
  }
  const reg_fin = reg.fin ? new Date(reg.fin) : (reg.estado === 'activo' ? ahora : null);
  if (reg_fin && reg_fin > gap_start) gap_start = reg_fin;
}
// Trailing gap solo si no hay tarea activa
if (!tarea_activa && gap_start < fin_ref) {
  tiempo_no_clasificado_minutos += Math.round((fin_ref - gap_start) / 60000);
}
```

**Qué hace:** suma TODOS los huecos del día: entre entrada y primer registro, entre registros,
y desde el último registro hasta ahora (si no hay tarea activa).
Es un acumulado total del día — INTERPRETACIÓN A.

---

## B) Código del frontend que decide el overlay

### En `_timerActualizarEstado()` (línea ~3687):

```js
} else if (!json.tarea_activa) {
  const noClas = json.totales?.tiempo_no_clasificado_minutos || 0;
  _timerSetEstado(noClas >= _UMBRAL_BLOQUEO ? 'bloqueado' : 'jornada-sin-tarea');
}
```

### En `_timerSetEstado()` rama `bloqueado` (línea ~3743):

```js
} else if (nuevoEstado === 'bloqueado') {
  const noClas = _timerMetricas?.totales?.tiempo_no_clasificado_minutos || 0;
  icon.textContent = '⚠';
  text.textContent = `Sin tarea — ${_fmtDurMin(noClas)} sin clasificar`;
  ...
}
```

### Umbral:

```js
const _UMBRAL_BLOQUEO = 15;  // línea ~3631
```

**Respuesta a las preguntas:**
- Usa `tiempo_no_clasificado_minutos` del response (backend).
- No hace cálculo local propio.
- Umbral hardcodeado: **15 minutos**.

---

## C) Interpretación correcta

**INTERPRETACIÓN B es la correcta** para el bloqueo:

> "tiempo sin clasificar" para el bloqueo = hueco actual desde el fin del último registro hasta ahora.

El bloqueo debe ser "estás parado ahora mismo por más de 15 minutos", no "en algún momento del día acumulaste 15min sin clasificar".

Con el código actual (INTERPRETACIÓN A), la persona puede:
1. Trabajar hasta las 9:20 sin marcar → 20min acumulados
2. Iniciar tarea, trabajar 1h, finalizar
3. El campo `tiempo_no_clasificado_minutos` sigue siendo ≥20min
4. El overlay aparece inmediatamente al finalizar la tarea — **BUG**

---

## D) Dónde está el bug

**El bug está en el BACKEND.** `tiempo_no_clasificado_minutos` es el acumulado del día completo
y es el valor correcto para el panel expandible (el usuario quiere ver cuánto tiempo total
estuvo sin registrar). Pero ese mismo campo se usa para el bloqueo cuando debería usarse
un campo distinto: el hueco vigente desde el último registro hasta ahora.

**Fix:** agregar `hueco_actual_minutos` al response de `metricas-dia`:
- Si hay tarea activa: 0
- Si hay registros y el último tiene `fin`: minutos desde ese fin hasta ahora
- Si no hay registros pero sí jornada: minutos desde entrada hasta ahora
- Si no hay jornada: 0

El frontend cambia solo la condición de `_timerActualizarEstado` para usar `hueco_actual_minutos`,
manteniendo `tiempo_no_clasificado_minutos` para el panel.
