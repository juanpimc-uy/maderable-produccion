-- Agregar Shop Drawing al catálogo de centros virtuales
INSERT INTO centros_virtuales (nombre) VALUES ('Shop Drawing')
ON CONFLICT (nombre) DO NOTHING;

-- Verificación
SELECT * FROM centros_virtuales ORDER BY nombre;
