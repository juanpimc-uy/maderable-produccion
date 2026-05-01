-- ============================================
-- LOTE 6 — Costos directos al proyecto
-- ============================================
-- Permite imputar al proyecto costos que no vienen del JSONB de muebles:
--   1) OC de Zoho Books (con tracking cross-project)
--   2) Costo manual (descripcion + monto USD + fecha)
--
-- Tipo de cambio configurable (UYU -> USD por ahora).
-- Snapshot del TC al imputar (no retroactivo).
-- Sin estado de pago (out of scope).
-- ============================================

-- --------------------------------------------
-- Tabla: tipo_cambio
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS tipo_cambio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moneda_origen TEXT NOT NULL,
  moneda_destino TEXT NOT NULL,
  valor NUMERIC(10, 4) NOT NULL CHECK (valor > 0),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por UUID,
  CONSTRAINT tipo_cambio_par_unico UNIQUE (moneda_origen, moneda_destino)
);

-- Seed: UYU -> USD con valor inicial (JP lo edita desde Ajustes)
INSERT INTO tipo_cambio (moneda_origen, moneda_destino, valor)
VALUES ('UYU', 'USD', 40.0000)
ON CONFLICT (moneda_origen, moneda_destino) DO NOTHING;

-- --------------------------------------------
-- Tabla: costos_directos_proyecto
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS costos_directos_proyecto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id UUID NOT NULL REFERENCES proyectos_cache(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('oc', 'manual')),

  -- Campos para tipo 'oc'
  oc_numero TEXT,
  oc_total_usd NUMERIC(12, 2),  -- snapshot del total de la OC en USD al imputar

  -- Campos para tipo 'manual'
  descripcion TEXT,

  -- Comunes (siempre en USD, convertido si hubo TC)
  monto_usd NUMERIC(12, 2) NOT NULL CHECK (monto_usd > 0),
  moneda_original TEXT NOT NULL DEFAULT 'USD',
  monto_original NUMERIC(12, 2) NOT NULL CHECK (monto_original > 0),
  tc_aplicado NUMERIC(10, 4),  -- NULL si moneda_original=USD; si no, snapshot del TC
  fecha DATE NOT NULL,

  -- Auditoria (UUID sin FK para no acoplar al nombre exacto de la tabla de empleados)
  creado_por UUID,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validaciones de integridad por tipo
  CONSTRAINT oc_requiere_numero_y_total CHECK (
    tipo <> 'oc' OR (oc_numero IS NOT NULL AND oc_total_usd IS NOT NULL AND oc_total_usd > 0)
  ),
  CONSTRAINT manual_requiere_descripcion CHECK (
    tipo <> 'manual' OR (descripcion IS NOT NULL AND length(trim(descripcion)) > 0)
  ),
  CONSTRAINT tc_consistente CHECK (
    (moneda_original = 'USD' AND tc_aplicado IS NULL) OR
    (moneda_original <> 'USD' AND tc_aplicado IS NOT NULL AND tc_aplicado > 0)
  )
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_costos_directos_proyecto_id
  ON costos_directos_proyecto(proyecto_id);

CREATE INDEX IF NOT EXISTS idx_costos_directos_oc_numero
  ON costos_directos_proyecto(oc_numero)
  WHERE tipo = 'oc';

CREATE INDEX IF NOT EXISTS idx_costos_directos_fecha
  ON costos_directos_proyecto(fecha DESC);

-- --------------------------------------------
-- Verificacion (correr aparte despues del schema)
-- --------------------------------------------
-- SELECT * FROM tipo_cambio;
-- SELECT count(*) FROM costos_directos_proyecto;
