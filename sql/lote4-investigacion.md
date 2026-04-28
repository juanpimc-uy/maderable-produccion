# Lote 4 — Investigación de Schema

Query ejecutada contra Supabase REST API para detectar las tablas relevantes.

## Tablas encontradas y sus columnas

### `jornadas`
Función: **asistencia diaria** (entrada/salida por empleado por día)
Columnas: `id, empleado_id, fecha, entrada, salida, descanso_minutos, descanso_editado, editado_por, alerta_15h, tarde, ausente, notas`

⚠️ Esta NO es la tabla de timer de tareas. No tiene `proyecto_id`, `inicio`/`fin` por tarea, ni `estado`.

### `registros_trabajo`
Función: **timer de tareas** (una fila por tarea cronometrada)
Columnas: `id, empleado_id, jornada_id, proyecto_id, proyecto_nombre, item_id, item_nombre, centro, inicio, fin, estado, motivo_pausa, es_retrabajo, motivo_retrabajo, creado_at`

✅ Esta es la tabla correcta para el timer de oficina.
- `estado`: valores observados `'activo' | 'finalizado' | 'pausado'`
- `centro`: TEXT, acepta nombres de centros virtuales
- `jornada_id`: nullable (UUID sin NOT NULL)
- `item_id` / `item_nombre`: nullables, se dejan null para registros de oficina

### `proyectos_cache`
Columnas: `id, numero, nombre, cliente, estado, items, materiales, fecha_creacion, sincronizado_at, activo, obra, cliente_nombre, fecha_inicio, fecha_entrega, notas, muebles, sos_cargadas, modulos, creado_en`

### `empleados`
Columnas incluye `rol_app` (operario / oficina / admin)

### Tablas inexistentes
- `tiempos` → no existe
- `marcados` → no existe
- `centros_virtuales` → no existe (a crear)

---

## Decisión de arquitectura

El spec original asumía que el timer usaría `jornadas` con una columna `centro_virtual` nueva.
Dado el schema real:

| Spec original | Ajuste real |
|---------------|------------|
| ALTER TABLE jornadas ADD COLUMN centro_virtual | No necesario — `jornadas` es asistencia, no timer |
| INSERT en jornadas para timer | INSERT en `registros_trabajo` con `jornada_id=null` |
| fin IS NULL = timer activo | `estado='activo'` = timer activo |
| "jornada_id" en endpoints | "registro_id" en endpoints (id de `registros_trabajo`) |

Los endpoints usan `registros_trabajo` directamente. El campo `centro` (TEXT) ya existente acepta nombres de centros virtuales sin modificación de schema.

La única tabla nueva necesaria es `centros_virtuales` (catálogo de centros válidos).
