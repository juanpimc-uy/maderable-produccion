# Lote 6 — Investigación: Costos Directos al Proyecto

## 1. Schema propuesto: `costos_directos_proyecto`

Ver `/sql/lote6-schema.sql` para el SQL completo.

```
id             UUID          PK, gen_random_uuid()
proyecto_id    TEXT          NOT NULL   (FK lógica a proyectos_cache.id)
tipo           TEXT          NOT NULL   CHECK IN ('oc', 'manual')
descripcion    TEXT          NOT NULL
monto_usd      NUMERIC(12,2) NOT NULL   CHECK > 0
fecha          DATE          NOT NULL   DEFAULT CURRENT_DATE
oc_numero      TEXT          NULLABLE   — requerido si tipo='oc'
oc_zoho_id     TEXT          NULLABLE   — purchaseorder_id de Zoho
oc_total_usd   NUMERIC(12,2) NULLABLE   — total de la OC al momento de imputar
oc_proveedor   TEXT          NULLABLE   — vendor_name de Zoho
creado_por     TEXT          NOT NULL   — empleado_id del admin
creado_en      TIMESTAMPTZ   DEFAULT now()
actualizado_en TIMESTAMPTZ   DEFAULT now()
```

**Índices:**
- `idx_cdp_oc_numero` sobre `oc_numero WHERE oc_numero IS NOT NULL` → tracking cross-project
- `idx_cdp_proyecto_id` sobre `proyecto_id` → listado por proyecto

**Por qué no FK dura a proyectos_cache:** `proyectos_cache.id` es TEXT generado en el cliente (no un sequence de Supabase), y no existe constraint PK verificada en la migration actual. FK lógica es suficiente.

---

## 2. Cómo buscar una OC en Zoho Books

El proxy existente `/api/zoho-books.js` acepta cualquier endpoint de Zoho v3.
Para purchase orders:

```js
// PASO 1 — Buscar por número (el admin tipea "1234" o "OC-1234")
const token = await getZohoToken();
const candidatos = [`OC-${base}`, `OC-${base.padStart(5,'0')}`, base];

for (const num of candidatos) {
  const r = await fetch(
    `/api/zoho-books?endpoint=${encodeURIComponent('purchaseorders?purchaseorder_number=' + num)}&token=${token}`
  );
  const d = await r.json();
  const found = d.purchaseorders?.[0];
  if (found) { ocId = found.purchaseorder_id; ocNumUsado = num; break; }
}

// PASO 2 — Traer detalle completo (para total y proveedor)
const r2 = await fetch(`/api/zoho-books?endpoint=purchaseorders/${ocId}&token=${token}`);
const d2 = await r2.json();
const oc = d2.purchaseorder;
// oc.total         → monto total de la OC (USD)
// oc.vendor_name   → proveedor
// oc.purchaseorder_number → número normalizado
// oc.line_items    → ítems (no necesarios para imputación simple)
```

El proxy construye internamente:
```
https://www.zohoapis.com/books/v3/purchaseorders?purchaseorder_number=OC-1234&organization_id={ORG_ID}
```

**Nota:** `getZohoToken()` existe solo en el frontend (nuevo-proyecto.html, admin.html).
En el backend (api/tiempos.js) NO hay autenticación Zoho — el token siempre viene del cliente.
Para el endpoint de imputación OC, el frontend deberá obtener el token y pasarlo al backend,
o el backend deberá llamar directamente a `/api/zoho-token` internamente.

**Decisión recomendada:** el frontend obtiene el token (como ya lo hace en nuevo-proyecto.html)
y lo pasa como parámetro al endpoint de backend `POST imputar-oc`.

---

## 3. Tracking cross-project

Query para calcular disponible de una OC:

```sql
SELECT
  COALESCE(SUM(monto_usd), 0) AS ya_imputado
FROM costos_directos_proyecto
WHERE oc_numero = $1
  AND id != $2;   -- excluir el registro actual si es una edición
```

El `oc_total_usd` se obtiene siempre en tiempo real desde Zoho (no se cachea como referencia
para el cálculo — solo se guarda como snapshot en el registro para auditoría).

Disponible = `oc_total_zoho` - `ya_imputado`

---

## 4. Casos edge

### ¿Qué pasa si la OC no existe en Zoho?
- El frontend busca en Zoho en los 3 formatos de número y no encuentra nada.
- Error al usuario: "OC-XXXX no encontrada en Zoho Books".
- No se llama al backend. No se crea registro.

### ¿Qué pasa si edita un costo OC y reduce el monto?
- Al reducir, el disponible aumenta → siempre válido, sin re-validar.
- Al aumentar: re-validar. Fórmula: `ya_imputado_otros + nuevo_monto <= oc_total`.
  - `ya_imputado_otros` = suma de todos los registros con mismo `oc_numero` **excepto** el que se edita.
- El backend recibe el `id` del registro a editar y lo excluye del cálculo.

### ¿Qué pasa si se elimina un costo OC?
- Se elimina el registro. El monto queda liberado automáticamente.
- El tracking es dinámico (SUM en tiempo real), no hay estado cacheado que actualizar.
- Siguiente imputación de la misma OC encontrará el disponible actualizado.

### ¿Validamos monto > 0?
- **Sí.** CHECK `monto_usd > 0` en la tabla.
- El backend también valida antes del INSERT/UPDATE.
- Un costo de 0 no tiene sentido en ningún tipo.

### ¿Permitimos costo manual con monto 0?
- **No.** Mismo constraint. No tiene sentido semántico.
- Si el admin quiere registrar algo sin monto definido aún, que lo haga cuando lo sepa.

### ¿Qué pasa si el monto a imputar excede el disponible?
- Backend rechaza con 422 y mensaje: 
  `"OC-1234 total $1500. Ya imputado $400 en otros proyectos. Disponible: $1100. Monto solicitado: $1300."`
- No se crea el registro.

### ¿Qué pasa si la OC tiene moneda distinta a USD?
- Zoho Books Uruguay puede tener OCs en UYU.
- `oc.total` viene en la moneda de la OC. `oc.currency_code` indica cuál.
- **Decisión:** si `currency_code !== 'USD'`, rechazar con error claro:
  `"La OC está en UYU. Solo se admiten OCs en USD. Convertí el monto manualmente usando un costo manual."`
- Esto evita tener que manejar tipo de cambio en esta iteración.

---

## 5. Diseño de endpoints (para discutir antes de implementar)

| Endpoint | Tipo | Descripción |
|---|---|---|
| `buscar-oc-zoho` | GET | Trae datos de una OC de Zoho + disponible cross-project |
| `agregar-costo-directo` | POST | Inserta en costos_directos_proyecto (tipo oc o manual) |
| `costos-directos-proyecto` | GET | Lista costos directos de un proyecto |
| `editar-costo-directo` | POST | Edita descripción/monto; re-valida si OC y aumenta |
| `eliminar-costo-directo` | POST | Elimina definitivamente |

El endpoint `costos-proyecto` existente (Lote 5) deberá sumar los costos directos al total.
