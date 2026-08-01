-- Auditoría de operaciones del kiosco de planta (planta-kioscos.html)
-- empleado_id es TEXT para ser consistente con jornadas/registros_trabajo.
CREATE TABLE IF NOT EXISTS kiosco_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id TEXT NOT NULL,
  accion TEXT NOT NULL,          -- login | abrir_flujo | cerrar_flujo | logout | timeout | (ops futuras)
  detalles JSONB DEFAULT '{}',
  creado_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_kiosco_log_empleado ON kiosco_log (empleado_id, creado_at DESC);
ALTER TABLE kiosco_log ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo el backend (service role) escribe/lee. Igual que el resto del core.
