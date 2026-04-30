# Lote 4.3.4 — Fix timing bar, salida en bloqueado, jornadas huérfanas

## Bugs corregidos

### Bug 1 — Click en barra antes de que metricas-dia responda

**Antes:** `initTimerBar()` mostraba la barra con `_timerEstado = null` mientras esperaba el fetch.
Si el usuario clickeaba durante ese intervalo (200-800ms), `_timerBarClick` era un no-op silencioso.

**Después:**
- `initTimerBar()` llama `_timerSetEstado('cargando')` antes del fetch
- La barra muestra "… Cargando…" durante el fetch
- `_timerBarClick` retorna inmediatamente si `_timerEstado === 'cargando'` (o null)

### Bug 2 — Botón "Salida del día" no visible en estado bloqueado

**Antes:** En el estado `bloqueado`, `_timerSetEstado` no hacía visible `#timer-btn-salida`.
El usuario bloqueado solo podía iniciar tarea (desde el overlay), no salir.

**Después:** `timer-btn-salida` ahora es visible también en estado `bloqueado`.

```
Estado        | timer-btn-salida visible
--------------|------------------------
sin-jornada   | NO  (correcto)
jornada-sin-t | SÍ
tarea-activa  | SÍ
descanso-act  | SÍ
bloqueado     | SÍ  ← fix
```

---

## Nueva funcionalidad — Jornadas huérfanas

### Qué son

Jornadas de días anteriores (`fecha < hoy`) con `salida = NULL`.
Ocurre cuando el empleado cierra la laptop sin marcar salida.

### Backend — dos nuevos endpoints

#### `GET jornadas-abiertas-anteriores`

Parámetros: `empleado_id`

Devuelve lista de jornadas huérfanas con metadatos:

```json
{
  "ok": true,
  "jornadas": [
    {
      "id": "...",
      "fecha": "2026-04-28",
      "entrada": "2026-04-28T08:03:00Z",
      "total_registros": 4,
      "ultimo_fin": "2026-04-28T17:42:00Z"
    }
  ]
}
```

#### `POST cerrar-jornada-huerfana`

Body: `{ empleado_id, jornada_id, salida_estimada? }`

- Verifica que la jornada pertenezca al empleado y esté abierta
- Si hay registro activo en esa jornada, lo cierra con `_finalizarTareaImpl` (estado `pausado`)
- Actualiza `jornadas.salida = salida_estimada || now()`

### Frontend — badge + modal

**Badge en la timer bar:**
- Botón `#timer-btn-huerfanas` visible solo si hay jornadas huérfanas
- Aparece en cualquier estado (no bloquea otros botones)
- Muestra conteo: "⚠ Jornadas sin cerrar (2)"

**Modal de jornadas huérfanas:**
- Lista cada jornada con fecha legible, hora de entrada, último registro, conteo de registros
- Botón "Cerrar con hora estimada" — usa `ultimo_fin` como `salida_estimada`, o `entrada` si no hay registros
- Tras cerrar cada jornada, la lista se actualiza; si no quedan huérfanas, el modal se cierra y el badge desaparece

**Flujo de chequeo:** `_timerCheckJornadasHuerfanas()` se llama una vez al inicio de `initTimerBar()` tras resolver el estado inicial.

---

## Lo que NO se modificó

- `planta2.html`
- Lógica de estado de timer (metricas-dia como fuente de verdad)
- `_timerActualizarEstado` (polling cada 30s) — no chequea huérfanas en cada poll
- Endpoint `salida-v2` (sigue siendo el salida para jornada de hoy)
