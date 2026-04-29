# Lote 4.3.1 — Fix descanso pausado acumula minutos

## Problema

Cuando se cerraba un descanso **por cambio de tarea** (`_iniciarTareaImpl`) o por
**salida del día** (`_salidaImpl`), sus minutos NO se sumaban a `jornadas.descanso_minutos`.

Ambas funciones hacían un UPDATE ciego:
```js
await sb.from('registros_trabajo')
  .update({ fin: ahora, estado: 'pausado' })
  .eq('empleado_id', empleado_id).eq('estado', 'activo');
```

Sin leer el registro activo previo, era imposible saber si era un descanso ni acceder a
su `jornada_id` para acumular.

Solo `_finalizarTareaImpl` (finalizar explícito) acumulaba correctamente.

---

## Solución adoptada

**Reutilizar `_finalizarTareaImpl`** en lugar de duplicar lógica.

`_finalizarTareaImpl` ya maneja:
- Lookup de `es_descanso` por centro en `centros_virtuales`
- Cálculo de duración y acumulación en `jornadas.descanso_minutos` si `es_descanso`
- Para descanso: fuerza `estado='finalizado'` (no se "pausa" un descanso)
- Para tarea normal: respeta `estado_final` (se pasa 'pausado')

El cambio en ambas funciones es idéntico: leer el registro activo con `.maybeSingle()`,
y si existe, delegarlo a `_finalizarTareaImpl(sb, { empleado_id, registro_id, estado_final: 'pausado' })`.

---

## Cambios aplicados

### `_iniciarTareaImpl` — paso 5

```js
// ANTES
await sb.from('registros_trabajo')
  .update({ fin: ahora, estado: 'pausado' })
  .eq('empleado_id', empleado_id).eq('estado', 'activo');

// DESPUÉS
const { data: activoPrev } = await sb.from('registros_trabajo')
  .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
if (activoPrev) {
  await _finalizarTareaImpl(sb, {
    empleado_id,
    registro_id: activoPrev.id,
    estado_final: 'pausado',
  });
}
```

### `_salidaImpl`

```js
// ANTES
await sb.from('registros_trabajo')
  .update({ fin: ahora, estado: 'pausado' })
  .eq('empleado_id', empleado_id).eq('estado', 'activo');

// DESPUÉS
const { data: activoSalida } = await sb.from('registros_trabajo')
  .select('id').eq('empleado_id', empleado_id).eq('estado', 'activo').maybeSingle();
if (activoSalida) {
  await _finalizarTareaImpl(sb, {
    empleado_id,
    registro_id: activoSalida.id,
    estado_final: 'pausado',
  });
}
```

---

## Casos de prueba mentales

| Caso | Comportamiento esperado | ¿Correcto? |
|------|------------------------|------------|
| Entrada → tarea → descanso → volver a tarea (cambio) | Descanso se cierra como 'finalizado' + minutos acumulados en `descanso_minutos` | ✓ |
| Entrada → descanso → salida del día sin volver a tarea | Descanso se cierra como 'finalizado' + minutos acumulados antes de cerrar jornada | ✓ |
| Entrada → tarea A → cambiar a tarea B (no descanso) | Tarea A se cierra como 'pausado', NO suma a `descanso_minutos` | ✓ |
| Entrada → tarea → salida del día (no descanso activo) | Tarea se cierra como 'pausado', NO suma a `descanso_minutos` | ✓ |
| Entrada → descanso → finalizar descanso explícito (▼ Finalizar) | Sigue funcionando como antes — `_finalizarTareaImpl` no se tocó | ✓ |
| Entrada → primera tarea del día (no hay activo previo) | `activoPrev = null`, no llama a `_finalizarTareaImpl`, comportamiento igual | ✓ |

---

## Resuelve deuda técnica documentada en Lote 4.3

> "descanso cerrado como pausado (no acumula descanso_minutos) cuando
> se inicia nueva tarea sin finalizar el descanso explícitamente"

Ahora tanto el cambio de tarea como la salida del día acumulan correctamente.
