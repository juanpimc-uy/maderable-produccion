# Lote 4.3.3 — Investigación z-index

## Selectores CSS y z-index actuales en admin.html

| Selector | z-index | Línea | Descripción |
|----------|---------|-------|-------------|
| `#timer-bloqueo-overlay` | **9000** | ~222 | Overlay rojo de bloqueo (pantalla completa) |
| `#timer-modal-overlay` | **500** | ~285 | Modal de iniciar/cambiar tarea |
| `#timer-entrada-overlay` | **500** | ~325 | Modal de entrada del día (opciones A/B) |
| `.overlay` | **100** | ~81 | Modal genérico del sistema (proyectos, operarios, etc.) |
| `#login-overlay` | **9999** | ~128 | Pantalla de login |
| Banner inline | **999** | ~1930 | Toast de éxito (inline style) |

## Diagnóstico

Los modales de tarea (`#timer-modal-overlay`) y entrada (`#timer-entrada-overlay`) están
en z-index **500**, que es menor que el overlay de bloqueo en z-index **9000**.

Al abrir cualquiera de esos modales desde el overlay, el modal queda renderizado debajo
del overlay rojo y el usuario no puede interactuar con él.

## Jerarquía correcta

```
login-overlay     9999  ← siempre encima de todo
modales timer     9500  ← encima del overlay de bloqueo
bloqueo-overlay   9000  ← sigue activo de fondo
banner/toasts     1000  ← encima de modales normales pero debajo del bloqueo
modal genérico    100   ← para el resto de modales (sin conflicto con bloqueo)
```

## Fix necesario

Subir `#timer-modal-overlay` y `#timer-entrada-overlay` de z-index 500 a z-index 9500.
