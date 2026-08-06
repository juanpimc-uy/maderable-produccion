-- INV-3c: índice para resolver unidades por código (kiosco scan)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_unidades_codigo ON inv_unidades (codigo);
