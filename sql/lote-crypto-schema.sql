-- Agregar columna password_hash para login con contraseña hasheada (admin)
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS password_hash TEXT;
