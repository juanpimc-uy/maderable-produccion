# Lote 4.2 — Refactor unificado de endpoints de tiempo

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `sql/lote4-2-schema.sql` | ALTER TABLE + INSERT centro Descanso. **Ejecutar manualmente en Supabase.** |
| `api/tiempos.js` | 5 helpers unificados + 5 endpoints v2 + 7 endpoints legacy como wrappers |

---

## Helpers extraídos

| Helper | Usado por |
|--------|-----------|
| `_entradaImpl(sb, { empleado_id })` | `entrada`, `entrada-v2`, `_iniciarTareaImpl` (auto-jornada) |
| `_salidaImpl(sb, { empleado_id })` | `salida`, `salida-v2` |
| `_tiempoActivoImpl(sb, { empleado_id })` | `tiempo-activo`, `tiempo-activo-v2` |
| `_iniciarTareaImpl(sb, params)` | `iniciar-tarea`, `iniciar-tarea-v2`, `iniciar-tiempo-oficina` |
| `_finalizarTareaImpl(sb, params)` | `finalizar-tarea`, `finalizar-tarea-v2`, `detener-tiempo-oficina` |

---

## Nuevos endpoints v2

| Endpoint | Método | Body / Params |
|----------|--------|--------------|
| `entrada-v2` | POST | `{ empleado_id }` |
| `salida-v2` | POST | `{ empleado_id }` |
| `iniciar-tarea-v2` | POST | `{ empleado_id, proyecto_id, proyecto_nombre, centro, item_id?, item_nombre? }` |
| `finalizar-tarea-v2` | POST | `{ empleado_id, registro_id?, estado_final? }` |
| `tiempo-activo-v2` | GET | `?empleado_id=` |

---

## Lógica de descanso (nueva)

Cuando `centro === 'Descanso'` (es_descanso = true en centros_virtuales):
- `_iniciarTareaImpl`: **no requiere** `proyecto_id` ni `item_id`
- `_finalizarTareaImpl`: al cerrar, **calcula duración** y hace
  `jornadas.descanso_minutos += durMin`

Esto significa que el tiempo de descanso se registra en `registros_trabajo`
(inicio/fin/centro='Descanso') Y se refleja en `jornadas.descanso_minutos`
para el cálculo de horas netas.

---

## Acción manual previa a probar

1. Ejecutar `/sql/lote4-2-schema.sql` en Supabase SQL Editor
2. Verificar que `centros_virtuales` tenga la columna `es_descanso`
3. Verificar que el centro 'Descanso' exista con `es_descanso = true`
4. Los otros centros deben tener `es_descanso = false` (por default)

---

## Cómo probar (sin tocar UI)

### Operario en planta2.html (todo debe funcionar igual que antes)

1. Abrir `planta2.html` → loguear como operario con cédula + PIN
2. **Marcar entrada** → debe abrir jornada (mismo comportamiento)
3. **Iniciar tarea** (wizard: proyecto → item → centro → confirmar)
   → debe iniciar registro (mismo comportamiento)
4. **Cambiar tarea** sin finalizar → la anterior queda `estado='pausado'`
   (mismo comportamiento)
5. **Finalizar tarea** con checklist → `estado='finalizado'`
   (mismo comportamiento)
6. **Salida del día** → cierra registro activo como 'pausado' + cierra jornada
   (mismo comportamiento)

### Oficina en admin.html (todo debe funcionar igual que antes)

1. Abrir modal de timer → elegir proyecto + centro (p.ej. Coordinacion)
2. **Iniciar tiempo** → registro se crea; si la sesión no tenía jornada
   previa, se auto-crea una transparentemente
3. **Barra de timer** debe mostrar todo igual (centro, proyecto, item si aplica)
4. **Detener tiempo** → `estado='finalizado'`, `duracion_minutos` en response

### Verificación adicional vía curl

```bash
# tiempo-activo ahora incluye es_descanso=false para centros normales:
curl "https://<host>/api/tiempos?action=tiempo-activo&empleado_id=XXX"
# Response: { "activo": { ..., "es_descanso": false } }

# centros-virtuales ahora incluye es_descanso:
curl "https://<host>/api/tiempos?action=centros-virtuales"
# Response: { "centros": [{ "id": "...", "nombre": "Descanso", "es_descanso": true }, ...] }
```

---

## Lo que NO se puede probar en este lote

- **Centro Descanso**: no hay UI todavía. El endpoint existe y funciona,
  pero requiere llamar `iniciar-tarea-v2` (o `iniciar-tiempo-oficina`) con
  `centro = 'Descanso'` sin `proyecto_id`. La UI se agrega en Lote 4.3.
- **Salida del día desde admin.html**: no hay botón de salida en admin.html.
  `salida-v2` existe pero no se llama desde ningún frontend aún. Lote 4.3.
- **Entrada explícita de oficina**: `entrada-v2` existe pero admin.html
  no lo llama. El wrapper `iniciar-tiempo-oficina` auto-crea jornada
  transparentemente cuando es necesario.

---

## Casos borde verificados mentalmente

| Caso | Comportamiento esperado | ¿Correcto? |
|------|------------------------|------------|
| `iniciar-tarea-v2` sin jornada activa | 400 "Sin jornada activa" | ✓ (`_autoJornada=false` por defecto) |
| `iniciar-tarea-v2` con centro Descanso, sin proyecto | OK — descanso no requiere proyecto | ✓ |
| `iniciar-tarea-v2` operario con centro no autorizado | 400 "Centro no autorizado" | ✓ |
| `iniciar-tiempo-oficina` sin jornada previa | Auto-upsert jornada, inserta OK | ✓ (`_autoJornada=true`) |
| `finalizar-tarea-v2` con centro Descanso | Cierra como 'finalizado' + suma durMin a jornada | ✓ |
| `finalizar-tarea-v2` con centro Descanso pero jornada_id=null | Cierra como 'finalizado'; no intenta actualizar jornada | ✓ |
| `salida-v2` sin jornada activa | Cierra registros activos; `jornada: null` en response | ✓ (`.maybeSingle()`) |
| `detener-tiempo-oficina` registro de otro empleado | 403 "No autorizado" | ✓ (heredado del helper) |
| `iniciar-tarea` legacy con `jornada_id` explícito | Usa ese `jornada_id` directamente (`_jornada_id`) | ✓ |

---

## Notas de implementación

### `_iniciarTareaImpl`: flags internos

- `_jornada_id`: para wrappers legacy (planta) que ya conocen el jornada_id;
  bypasea el lookup por fecha.
- `_autoJornada`: para `iniciar-tiempo-oficina`; si no hay jornada activa,
  hace upsert automático via `_entradaImpl`.
- Sin ninguno de los dos: `iniciar-tarea-v2` exige jornada activa o devuelve 400.

### Cambio aditivo en `tiempo-activo`

El wrapper legacy ahora incluye `es_descanso` en la respuesta. Este campo
es nuevo (antes no existía). `admin.html` usa `_timerRegistro.centro`,
`.proyecto_nombre`, `.item_nombre`, `.inicio` — no lee `es_descanso`.
Compatible hacia atrás.

### `iniciar-tiempo-oficina`: proyecto_id ya no es required en la validación

Antes: `if (!empleado_id || !proyecto_id || !centro_virtual) return err(...)`.
Ahora: `if (!empleado_id || !centro_virtual) return err(...)`.
`proyecto_id` lo valida el helper (requerido si !es_descanso). El cambio
no afecta el flujo actual (siempre se manda `proyecto_id` desde admin.html).

---

## Restricciones cumplidas

- NO se modificó `planta2.html`
- NO se modificó `admin.html`
- Endpoints legacy siguen funcionando con el mismo body/response de siempre
- NO se ejecutó ningún ALTER TABLE automáticamente
- NO se inventaron columnas nuevas en `registros_trabajo`
