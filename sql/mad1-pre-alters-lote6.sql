-- Preparación de costos_directos_proyecto para módulo Madera
-- Ejecutar ANTES del schema principal de MAD-1

-- 1) Ampliar CHECK del tipo para incluir 'madera'
ALTER TABLE costos_directos_proyecto
  DROP CONSTRAINT IF EXISTS costos_directos_proyecto_tipo_check;

ALTER TABLE costos_directos_proyecto
  ADD CONSTRAINT costos_directos_proyecto_tipo_check
  CHECK (tipo IN ('oc','manual','madera'));

-- 2) Verificar y eliminar CHECK monto_usd >= 0 si existe
DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn FROM pg_constraint
  WHERE conrelid = 'costos_directos_proyecto'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%monto_usd%>=%0%';
  IF cn IS NOT NULL THEN
    EXECUTE 'ALTER TABLE costos_directos_proyecto DROP CONSTRAINT ' || cn;
  END IF;
END $$;

-- 3) Agregar columna nullable
ALTER TABLE costos_directos_proyecto
  ADD COLUMN IF NOT EXISTS movimiento_madera_id UUID NULL;
