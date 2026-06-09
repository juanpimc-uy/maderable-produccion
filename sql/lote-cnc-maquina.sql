ALTER TABLE registros_trabajo ADD COLUMN IF NOT EXISTS maquina text;
-- valores: 'escuadradora' | 'cnc' | NULL (solo se setea cuando centro='corte')
