# Lote 4.1 — Item condicional + Shop Drawing

## Cambios

| Archivo | Qué cambió |
|---------|-----------|
| `sql/lote4-1-schema.sql` | INSERT Shop Drawing en `centros_virtuales`. **Ejecutar manualmente en Supabase.** |
| `sql/lote4-1-investigacion.md` | Schema discovery: items son JSONB en `proyectos_cache.muebles` |
| `api/tiempos.js` | `iniciar-tiempo-oficina` acepta `item_id`/`item_nombre`; `tiempo-activo` los devuelve |
| `admin.html` | Grilla de 7 centros + sección ITEM condicional + barra muestra código de item |

---

## Centros con item obligatorio

`Shop Drawing`, `Modelado`, `Cam`

Los centros `Compras`, `Coordinacion`, `Reunion`, `Supervision` **no requieren item** y el selector no aparece.

---

## Schema a ejecutar en Supabase

```sql
-- Ver sql/lote4-1-schema.sql
INSERT INTO centros_virtuales (nombre) VALUES ('Shop Drawing')
ON CONFLICT (nombre) DO NOTHING;
```

---

## Comportamiento del modal

1. Elegir proyecto (búsqueda por texto)
2. Elegir centro (grilla de 7 botones)
3. Si el centro requiere item → aparece el selector **ITEM** con los muebles del proyecto
4. Botón **▶ INICIAR** habilitado solo cuando: proyecto ✓ + centro ✓ + item (si aplica) ✓

## Comportamiento de la barra de timer

- Sin item: `● Cam  en  P-001 · MUEBLE XYZ  ·  01:23:45`
- Con item: `● Shop Drawing · MF01  en  P-001 · MUEBLE XYZ  ·  01:23:45`

---

## Cómo probar

1. Ejecutar `sql/lote4-1-schema.sql` en Supabase SQL Editor
2. Abrir modal → elegir proyecto → elegir **Shop Drawing**
3. Verificar que aparece el selector ITEM con los muebles del proyecto
4. Elegir un item → Iniciar
5. Barra muestra el código del item en el label
6. Elegir **Coordinacion** → verificar que el selector ITEM no aparece
7. Verificar en `registros_trabajo`: `item_id` y `item_nombre` poblados para Shop Drawing, `null` para Coordinacion

---

## Limitaciones conocidas (heredadas de Lote 4)

- Sin edición retroactiva de tiempos — Lote 5
- $/h de oficina = 0 — Lote 5
