-- Agregar columna password_hash para login con contraseña bcrypt (admin)
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS password_hash TEXT;
