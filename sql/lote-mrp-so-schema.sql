-- ═══════════════════════════════════════════════════════════════
-- MRP — Armado de SO: tablas de estado
-- NO ejecutar automáticamente — JP corre manualmente
-- ═══════════════════════════════════════════════════════════════

-- Estado a nivel SO (ocultar, vincular proyecto)
CREATE TABLE IF NOT EXISTS so_estado (
  so_zoho_id     TEXT PRIMARY KEY,
  so_numero      TEXT NOT NULL,
  proyecto_id    UUID REFERENCES proyectos_cache(id),
  oculta         BOOLEAN DEFAULT FALSE,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Estado por línea de ítem
CREATE TABLE IF NOT EXISTS so_lineas_estado (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_zoho_id      TEXT NOT NULL,
  linea_zoho_id   TEXT NOT NULL,
  cantidad_armada NUMERIC DEFAULT 0 CHECK (cantidad_armada >= 0),
  eliminada       BOOLEAN DEFAULT FALSE,
  actualizado_por UUID REFERENCES empleados(id),
  actualizado_en  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (so_zoho_id, linea_zoho_id)
);

CREATE INDEX IF NOT EXISTS idx_so_lineas_estado_so ON so_lineas_estado(so_zoho_id);

-- Cachear obra y mueble en so_estado
ALTER TABLE so_estado ADD COLUMN IF NOT EXISTS obra TEXT DEFAULT '';
ALTER TABLE so_estado ADD COLUMN IF NOT EXISTS mueble TEXT DEFAULT '';
ALTER TABLE so_estado ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'pendiente';
