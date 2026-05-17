-- ============================================
-- Tercerizados — proveedores + numero de envío
-- JP ejecuta manualmente
-- ============================================

-- Tabla de proveedores tercerizados
CREATE TABLE IF NOT EXISTS proveedores_terceros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'lus',  -- 'lus' o 'tap'
  icono TEXT DEFAULT '✨',
  activo BOOLEAN DEFAULT true,
  creado_en TIMESTAMPTZ DEFAULT now()
);

-- Seed con proveedores actuales (tomados de config_global.proveedores)
-- Ajustar nombres si difieren de los reales
INSERT INTO proveedores_terceros (nombre, tipo, icono) VALUES
  ('Lustrador', 'lus', '✨'),
  ('Tapicero', 'tap', '🧵')
ON CONFLICT DO NOTHING;

-- Columnas adicionales en partidas_terceros para envío
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS numero_envio TEXT;
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS cliente TEXT DEFAULT '';
ALTER TABLE partidas_terceros ADD COLUMN IF NOT EXISTS bultos INTEGER DEFAULT 0;

-- Secuencia para auto-incrementar número de envío
CREATE SEQUENCE IF NOT EXISTS envio_seq START 1;

-- Función RPC para obtener el próximo valor (llamada desde el edge function)
CREATE OR REPLACE FUNCTION nextval_envio()
RETURNS INTEGER AS $$
  SELECT nextval('envio_seq')::INTEGER;
$$ LANGUAGE SQL;
