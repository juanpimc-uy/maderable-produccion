# Lote 4.3.3 — Fix z-index modales sobre overlay de bloqueo

## Bug

Cuando un usuario estaba en estado bloqueado (overlay rojo "TIEMPO SIN CLASIFICAR") y
apretaba "▶ INICIAR TAREA", el modal de tarea se abría pero quedaba detrás del overlay.
El usuario no podía interactuar con él y quedaba atrapado sin forma de salir.

**Causa**: `#timer-modal-overlay` y `#timer-entrada-overlay` tenían `z-index: 500`,
menor que el overlay de bloqueo en `z-index: 9000`.

## Cambio

| Selector | Antes | Después |
|----------|-------|---------|
| `#timer-bloqueo-overlay` | 9000 | 9000 (sin cambio) |
| `#timer-modal-overlay` | 500 | **9500** |
| `#timer-entrada-overlay` | 500 | **9500** |
| `.overlay` (modal genérico) | 100 | 100 (sin cambio) |
| `#login-overlay` | 9999 | 9999 (sin cambio) |

## Jerarquía final

```
#login-overlay        9999  ← siempre encima de todo
#timer-modal-overlay  9500  ← encima del bloqueo
#timer-entrada-overlay 9500 ← encima del bloqueo
#timer-bloqueo-overlay 9000 ← sigue activo de fondo
banner inline          999
.overlay (genérico)    100
```

## Flujo correcto post-fix

1. Usuario en estado bloqueado — overlay rojo visible
2. Click "▶ INICIAR TAREA" en el overlay
3. Modal de tarea aparece encima del overlay rojo
4. Usuario elige proyecto + centro → INICIAR
5. Backend acepta, `_timerActualizarEstado()` se llama, `metricas-dia` devuelve `tarea_activa`
6. Frontend pasa a estado `tarea-activa`, overlay desaparece, modal se cierra

## Caso borde: cancelar desde el overlay

- Usuario en estado bloqueado → abre modal → cancela
- Modal se cierra
- Overlay sigue visible (porque sigue sin tarea activa)
- Usuario puede volver a intentar con "INICIAR TAREA"
- No rompe nada — `_timerModalCerrar()` solo oculta el modal, no afecta el overlay

## Lo que NO se modificó

- Lógica de cuándo aparece/desaparece el overlay (determinada por `metricas-dia`)
- `planta2.html`
- Cualquier otra funcionalidad del timer
