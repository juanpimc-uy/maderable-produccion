-- Agregar bandera es_descanso a centros_virtuales
ALTER TABLE centros_virtuales
  ADD COLUMN IF NOT EXISTS es_descanso BOOLEAN NOT NULL DEFAULT false;

-- Insertar centro Descanso
INSERT INTO centros_virtuales (nombre, es_descanso) VALUES ('Descanso', true)
ON CONFLICT (nombre) DO UPDATE SET es_descanso = true;

-- Verificación
SELECT id, nombre, activo, es_descanso FROM centros_virtuales ORDER BY nombre;
