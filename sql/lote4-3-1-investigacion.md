# Lote 4.3.1 — Investigación: acumulación de descanso al cerrar como pausado

## 1. Bloque actual en _iniciarTareaImpl paso 5 (líneas 212-215)

```js
  // 4. Validar proyecto / item (omitir si es descanso)
  if (!es_descanso) {
    if (!proyecto_id) throw new ApiError('proyecto_id requerido', 400);
    if (CENTROS_CON_ITEM.includes(centro)) {
      if (!item_id) throw new ApiError(`El centro ${centro} requiere especificar un item`, 400);
      const { data: proyecto, error: pErr } = await sb.from('proyectos_cache')
        .select('muebles').eq('id', proyecto_id).maybeSingle();
      if (pErr) throw pErr;
      if (!proyecto) throw new ApiError('Proyecto no encontrado', 404);
      const muebles = Array.isArray(proyecto.muebles) ? proyecto.muebles : [];
      if (!muebles.some(m => String(m.id) === String(item_id))) {
        throw new ApiError('El item especificado no existe en el proyecto', 400);
      }
    }
  }

  // 5. Cerrar registro activo anterior como 'pausado'
  await sb.from('registros_trabajo')
    .update({ fin: ahora, estado: 'pausado' })
    .eq('empleado_id', empleado_id).eq('estado', 'activo');

  // 6. Insertar nuevo registro
  const persistirItem = !es_descanso && CENTROS_CON_ITEM.includes(centro);
```

Es un UPDATE masivo sin SELECT previo. No lee `centro` ni `jornada_id` del registro activo previo.

## 2. ¿Necesita leer el registro activo primero?

Sí. Para determinar si el registro que se está cerrando es un descanso, necesita:
- `centro` → para lookup en `centros_virtuales.es_descanso`
- `jornada_id` → para el UPDATE de `jornadas.descanso_minutos`

Sin esos campos no hay forma de condicionar la acumulación.

## 3. ¿Puede reutilizarse _finalizarTareaImpl?

Sí, y es la opción más limpia. `_finalizarTareaImpl` ya hace exactamente lo necesario:
- Acepta `registro_id` explícito y `estado_final`
- Para centros descanso fuerza `estado='finalizado'` (correcto — no se pausa un descanso)
- Para centros normales usa `estado_final` (se pasa 'pausado' → correcto)
- Acumula `descanso_minutos` si `es_descanso && jornada_id`

**Plan**: en paso 5, primero hacer `.maybeSingle()` para obtener el `id` del registro activo.
Si existe, delegar a `_finalizarTareaImpl(sb, { empleado_id, registro_id: activo.id, estado_final: 'pausado' })`.
Si no existe (primera tarea del día), no hacer nada.

Esto evita duplicar la lógica de acumulación y garantiza un único punto de verdad.

## 4. _salidaImpl — mismo problema (líneas 119-130)

```js
async function _salidaImpl(sb, { empleado_id }) {
  const hoy = new Date().toISOString().split('T')[0];
  const ahora = new Date().toISOString();
  await sb.from('registros_trabajo')
    .update({ fin: ahora, estado: 'pausado' })
    .eq('empleado_id', empleado_id).eq('estado', 'activo');
  const { data } = await sb.from('jornadas')
    .update({ salida: ahora })
    .eq('empleado_id', empleado_id).eq('fecha', hoy).is('salida', null)
    .select().maybeSingle();
  return { jornada: data };
}
```

Mismo UPDATE ciego. Si el empleado hace salida del día estando en descanso, los minutos de ese
descanso no se acumulan.

**Mismo fix**: leer el registro activo (.maybeSingle), si existe llamar `_finalizarTareaImpl`
con `estado_final='pausado'`, luego cerrar la jornada.

## Conclusión

- Duplicar la lógica inline sería ~10 líneas pero violaría DRY — la lógica de acumulación
  ya existe en `_finalizarTareaImpl` y cambiaría en dos lugares si hay bugs futuros.
- Reutilizar `_finalizarTareaImpl` es más seguro, más corto, y no requiere ningún parámetro
  nuevo al helper (acepta `registro_id` explícito y `estado_final` ya).
