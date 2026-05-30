-- Tracking de origen de despacho (scan QR vs manual desde tercerizados)
ALTER TABLE partidas_terceros
  ADD COLUMN despacho_origen text;
-- valores: 'scan' | 'manual' | null (legacy)
