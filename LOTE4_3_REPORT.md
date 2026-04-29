# Lote 4.3 — UI completa de tiempo en admin.html

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `api/tiempos.js` | Nuevo endpoint `metricas-dia` + eliminación de `_autoJornada: true` en `iniciar-tiempo-oficina` |
| `admin.html` | Timer bar completa refactorizada (5 estados), modales de entrada y tarea, panel de métricas, overlay de bloqueo, CSS completo |

---

## Endpoints nuevos / modificados

### `GET metricas-dia?empleado_id=X`

Devuelve el estado completo del día:

```json
{
  "ok": true,
  "jornada": { ...jornada row o null },
  "tarea_activa": { ...registro row o null },
  "registros_dia": [ ...todos los registros del día ordenados por inicio ],
  "totales": {
    "duracion_jornada_minutos": 480,
    "descanso_acumulado_minutos": 30,
    "tiempo_clasificado_minutos": 380,
    "tiempo_no_clasificado_minutos": 70
  }
}
```

**Lógica de `tiempo_no_clasificado_minutos`:** Recorre los registros del día ordenados por inicio. Acumula los huecos entre el fin de uno y el inicio del siguiente. Incluye el hueco inicial (desde `jornada.entrada` hasta el primer registro). No incluye el hueco trailing si hay tarea activa.

**Lógica de `tiempo_clasificado_minutos`:** Suma duración de todos los registros cuyo centro NO sea `es_descanso`, incluyendo la tarea activa con duración hasta ahora.

### `iniciar-tiempo-oficina` (modificado)

Eliminado `_autoJornada: true`. El endpoint ahora devuelve 400 si no hay jornada activa, igual que `iniciar-tarea-v2`. La oficina debe registrar la entrada explícitamente vía `entrada-v2` (o modal de entrada del día).

---

## Estados de la barra de tiempo

| Estado | Color | Condición | Comportamiento |
|--------|-------|-----------|----------------|
| `sin-jornada` | Gris | `jornada === null` | Click → modal de entrada |
| `jornada-sin-tarea` | Amarillo desaturado | Jornada abierta, sin tarea activa, no clasificado < 15min | Click → modal de tarea; botón ⏹ Salida |
| `tarea-activa` | Amarillo FFD600 | Tarea activa, `es_descanso = false` | Cronómetro; botones ☕ Descanso, ✓ Finalizar, ⏹ Salida |
| `descanso-activo` | Cyan #0E7490 | Tarea activa, `es_descanso = true` | Cronómetro descanso; botones ▶ Volver a tarea, ⏹ Salida |
| `bloqueado` | Rojo | Jornada abierta, sin tarea, no clasificado ≥ 15min | Overlay rojo cubre toda la pantalla; único botón: INICIAR TAREA |

---

## Flujo completo del día (oficina/admin)

1. **Llegada**: barra gris → click → modal entrada → opción A (entrada + tarea) o B (solo entrada)
2. **Tarea activa**: barra amarilla → cronómetro corriendo
3. **Descanso**: botón ☕ → `iniciar-tarea-v2` con centro Descanso → barra cyan
4. **Volver a trabajo**: botón ▶ Volver a tarea → modal de tarea
5. **Cambiar tarea**: click en "CAMBIAR TAREA" (barra amarilla no es clickeable pero `_timerModalAbrir` puede llamarse) → modal dice "CAMBIAR TAREA", llama `iniciar-tarea-v2` que cierra la anterior como pausado
6. **Finalizar tarea**: botón ✓ → `finalizar-tarea-v2` → estado `jornada-sin-tarea`
7. **Salida**: botón ⏹ → confirm → `salida-v2` → estado `sin-jornada`

---

## Panel de métricas

Se muestra debajo de la barra cuando hay jornada abierta. Polling cada 30s.

| Métrica | Fuente |
|---------|--------|
| JORNADA | `totales.duracion_jornada_minutos` |
| CLASIFICADO | `totales.tiempo_clasificado_minutos` |
| DESCANSO | `totales.descanso_acumulado_minutos` (= `jornadas.descanso_minutos`) |
| SIN CLASIFICAR | `totales.tiempo_no_clasificado_minutos` (en rojo si > 5min) |

---

## Deuda técnica conocida

### Descanso cerrado como 'pausado' al iniciar nueva tarea

Cuando el usuario está en descanso y hace "Volver a tarea", `_timerVolverATarea()` llama
`_timerModalAbrir()` y luego `_timerIniciar()` que llama `iniciar-tarea-v2`. El helper
`_iniciarTareaImpl` cierra el registro activo (descanso) como `estado='pausado'` — pero
**no** acumula los `descanso_minutos` en `jornadas`, porque solo `_finalizarTareaImpl` hace
esa acumulación.

**Impacto**: el tiempo de ese descanso queda sin reflejar en `jornadas.descanso_minutos`,
por lo que las métricas del panel subestimarán el descanso real.

**Fix correcto**: en `_iniciarTareaImpl`, antes de cerrar el registro activo, verificar si
`es_descanso` y, si es así, calcular duración y acumular en `jornadas.descanso_minutos`.
No se hizo en este lote para no modificar el helper sin confirmación previa.

---

## Restricciones cumplidas

- NO se modificó `planta2.html`
- Los endpoints legacy (`iniciar-tiempo-oficina`, `detener-tiempo-oficina`, `tiempo-activo`) siguen funcionando
- `iniciar-tiempo-oficina` conserva su response shape `{ ok: true, registro: {...} }`
- No se ejecutó ningún ALTER TABLE
