-- ═══════════════════════════════════════════════════════════════════
-- Lote 6 — Tabla costos_directos_proyecto
-- Ejecutar manualmente en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS costos_directos_proyecto (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id    TEXT          NOT NULL,          -- FK lógica a proyectos_cache.id
  tipo           TEXT          NOT NULL,          -- 'oc' | 'manual'
  descripcion    TEXT          NOT NULL,
  monto_usd      NUMERIC(12,2) NOT NULL CHECK (monto_usd > 0),
  fecha          DATE          NOT NULL DEFAULT CURRENT_DATE,

  -- Campos exclusivos tipo = 'oc'
  oc_numero      TEXT,                            -- ej: 'OC-1234' (texto que ingresa el admin)
  oc_zoho_id     TEXT,                            -- purchaseorder_id interno de Zoho (para re-fetch rápido)
  oc_total_usd   NUMERIC(12,2),                  -- total de la OC en Zoho al momento de imputar
  oc_proveedor   TEXT,                            -- vendor_name de Zoho

  -- Auditoría
  creado_por     TEXT          NOT NULL,          -- empleado_id del admin
  creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CHECK (tipo IN ('oc', 'manual')),
  CHECK (tipo = 'manual' OR oc_numero IS NOT NULL)
);

ALTER TABLE costos_directos_proyecto DISABLE ROW LEVEL SECURITY;

-- Índice principal: tracking cross-project por número de OC
CREATE INDEX IF NOT EXISTS idx_cdp_oc_numero
  ON costos_directos_proyecto (oc_numero)
  WHERE oc_numero IS NOT NULL;

-- Índice secundario: listar costos de un proyecto
CREATE INDEX IF NOT EXISTS idx_cdp_proyecto_id
  ON costos_directos_proyecto (proyecto_id);

-- Verificación
SELECT * FROM costos_directos_proyecto LIMIT 0;
