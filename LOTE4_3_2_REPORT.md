# Lote 4.3.2 — Modalidad de descanso por persona

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `sql/lote4-3-2-schema.sql` | `empleados.descanso_modalidad`, `jornadas.descanso_excedido_minutos`, `descanso_minutos DEFAULT 0` |
| `api/tiempos.js` | `_finalizarTareaImpl` distribuye según modalidad; `metricas-dia` incluye campos nuevos; `empleados GET` incluye modalidad; `sync-empleado` acepta modalidad (admin only) |
| `admin.html` | OPERARIOS map incluye modalidad; `syncEmpleadoSupabase` pasa modalidad; modal operario tiene select de modalidad (admin only); barra descanso sin cronómetro; panel con EXCEDIDO y TIEMPO PAGO |

---

## Modalidades

| Valor | Comportamiento |
|-------|----------------|
| `paga_30` | Hasta 30 min de descanso son pagos. El exceso se acumula en `descanso_excedido_minutos` y no cuenta como tiempo pago. |
| `no_paga_60` | Ningún descanso es pago. `descanso_minutos` acumula sin límite. |
| `sin_limite` | Descansos no penalizan ni suman al pago. Idéntico a `no_paga_60` en contabilización. |
| `NULL` | Sin configurar — trata como `sin_limite`. |

---

## Campos nuevos en metricas-dia totales

| Campo | Descripción |
|-------|-------------|
| `descanso_excedido_minutos` | Minutos de descanso que exceden el límite pago (solo `paga_30`) |
| `descanso_minutos_actual_sesion` | Minutos de la sesión de descanso activa en curso |
| `descanso_excede_limite` | `true` si `paga_30` y `(acumulado + sesión_actual) > 30` |
| `descanso_exceso_minutos` | Cuántos minutos está por encima del límite (para el "⚠ +Xmin") |
| `tiempo_pago_minutos` | Para `paga_30`: trabajo + descanso_acumulado. Para el resto: solo trabajo |
| `descanso_modalidad` | Valor de la modalidad del empleado |

---

## UI de descanso

**Barra en estado descanso-activo:**
- Muestra solo "☕ Descanso" (sin cronómetro — discreción intencionada)
- Si `paga_30` y excede 30min: agrega "· ⚠ +Xmin" en `#c00000` (rojo apagado)
- Se actualiza cada 30s con el polling de `metricas-dia`

**Panel de métricas:**
- Fila TRABAJO (tiempo_clasificado_minutos)
- Fila DESCANSO (acumulado closed)
- Fila EXCEDIDO (solo si `paga_30` y exceso > 0, en rojo)
- Fila SIN CLASIFICAR (en rojo si > 5min)
- Fila TIEMPO PAGO (en verde, solo si hay modalidad configurada)

**Modal Editar Operario:**
- Select de modalidad solo visible para admin
- Oficina puede editar centros pero no ve la sección de modalidad

---

## Nota técnica: DEFAULT de descanso_minutos

El campo `jornadas.descanso_minutos` tenía `DEFAULT 30` (herencia del cálculo de horas estimadas). Se cambió a `DEFAULT 0` para que nuevas jornadas empiecen sin descanso acumulado. Jornadas existentes conservan su valor — no hay recálculo retroactivo.

---

## Acción manual previa a probar

1. Ejecutar `sql/lote4-3-2-schema.sql` en Supabase SQL Editor
2. Configurar modalidad de un empleado: admin.html → Operarios → Gestión → Editar → "30 min pagos" → Guardar

---

## Cómo probar

1. Loguear como admin con modalidad `paga_30`
2. Marcar entrada → iniciar tarea
3. Iniciar descanso → barra dice "☕ Descanso" sin cronómetro
4. Pasar 31 minutos → panel (30s refresh) mostrará "⚠ +1min" en la barra
5. Volver a tarea → panel: TRABAJO | DESCANSO 00:30 | EXCEDIDO 00:01 | TIEMPO PAGO verde
6. Con modalidad `no_paga_60`: descanso no aparece en TIEMPO PAGO, sin EXCEDIDO
7. Con modalidad `NULL`: igual que `sin_limite`

---

## Casos borde

- **Cambio de modalidad a mitad del día**: jornada actual ya tiene valores calculados. Las sesiones de descanso que se cierren de ahí en adelante usarán la nueva modalidad. Sin recálculo retroactivo.
- **Empleado sin modalidad (`NULL`)**: trata como `sin_limite` — todo descanso a `descanso_minutos`, `descanso_excedido_minutos = 0`.
- **Operario en planta**: campo de modalidad existe en la DB pero la UI de planta no marca descanso (no tiene ese flujo). El campo es ignorado en planta.
- **Descanso cerrado como pausado** (cambio de tarea o salida): ya resuelto en Lote 4.3.1 — `_finalizarTareaImpl` se llama correctamente y aplica la lógica de modalidad.

---

## Lo que NO se modificó

- `planta2.html`
- Endpoints legacy (`iniciar-tiempo-oficina`, `detener-tiempo-oficina`)
- Lógica de bloqueo por 15min sin tarea
- `tiempo_no_clasificado_minutos` (independiente de modalidad)

---

## Deudas técnicas

- **Recálculo retroactivo**: si se cambia la modalidad de un empleado, los días anteriores no se recalculan. Comportamiento esperado y documentado.
