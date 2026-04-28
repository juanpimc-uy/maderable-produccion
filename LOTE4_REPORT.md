# Lote 4 — Tiempos para oficina

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `sql/lote4-schema.sql` | CREATE TABLE `centros_virtuales` con 6 centros iniciales. **Ejecutar manualmente en Supabase.** |
| `sql/lote4-investigacion.md` | Schema discovery: confirmó que la tabla de timer es `registros_trabajo` (no `jornadas`). |
| `api/tiempos.js` | 4 endpoints nuevos: `centros-virtuales`, `tiempo-activo`, `iniciar-tiempo-oficina`, `detener-tiempo-oficina` |
| `admin.html` | Timer bar fija debajo del topbar + modal de marcado + lógica completa de start/stop/recover |

---

## Schema ejecutar en Supabase

```sql
-- Ver sql/lote4-schema.sql
-- Crea centros_virtuales y popula los 6 centros iniciales
```

Los registros de timer usan la tabla `registros_trabajo` existente:
- `jornada_id = null` (nullable, diferencia de operarios)
- `item_id = null`, `item_nombre = null`
- `centro` = nombre del centro virtual (campo TEXT ya existente)
- `estado` = `'activo'` → `'finalizado'`

---

## Cómo probar

### Flujo completo
1. Ejecutar `sql/lote4-schema.sql` en Supabase SQL Editor
2. Loguear como oficina o admin en admin.html
3. Ver la barra delgada "▶ Marcar tiempo" debajo del topbar
4. Click en la barra → modal con selector de proyecto + centro
5. Seleccionar proyecto (búsqueda por texto) + uno de los 6 centros
6. Click **▶ INICIAR** → modal se cierra, barra se vuelve amarilla con cronómetro en vivo
7. Navegar entre pestañas: la barra permanece visible y el timer sigue corriendo
8. Click **■ Detener** → botón cambia a "¿Confirmar?" (rojo, 3 segundos)
9. Segundo click → timer detenido, barra vuelve a gris
10. Verificar en Supabase `registros_trabajo`: fila con `inicio` y `fin` correctos, `estado='finalizado'`

### Persistencia al recargar
1. Iniciar un timer
2. Recargar admin.html (F5)
3. La barra debe aparecer en amarillo con el cronómetro corriendo desde el inicio original

### Caso 409 — timer doble
1. Iniciar un timer
2. Click en la barra (estado activo no abre modal, pero en otro tab/sesión intentar iniciar otro)
3. Debe mostrar "Ya tenés un timer corriendo en X — Y. Detenelo primero."

---

## Casos borde a probar

| Caso | Comportamiento esperado |
|------|------------------------|
| Iniciar timer cuando ya hay uno activo | 409 — mensaje inline en modal |
| Detener timer que no es tuyo (curl directo) | 403 |
| Operario logueado (si pudiera llegar a admin.html) | Timer bar oculta (no se muestra) |
| Centro virtual inválido (request manual) | 400 "Centro virtual no válido" |
| Red cae durante timer activo | Timer sigue corriendo localmente; al reconectar, Detener funciona igual |

---

## Limitaciones conocidas

- **$/h de oficina = 0** — los registros existen pero no contribuyen al costo calculado. Se define en Lote 5.
- **Sin edición manual de tiempos pasados** — solo start/stop en vivo. Edición retroactiva en Lote 5.
- **Timer abierto sin fin**: si el browser se cierra sin detener, el registro queda con `estado='activo'` y `fin=null` en Supabase. Al volver a admin.html, `GET tiempo-activo` lo restaura. El usuario debe detenerlo manualmente.
- **Sin toast nativo** si el `#toast-msg` no existe en el DOM — el mensaje de "Tiempo registrado" usa `alert()` como fallback.

---

## Lo que NO se modificó

- Marcado de operarios en planta2.html (intacto)
- Lógica de proyectos, despacho, materiales, stock
- Pestaña Tiempos en admin.html (eso es Lote 5)
- Endpoint GET empleados (sigue sin devolver PIN)
- Ningún endpoint existente fue modificado
