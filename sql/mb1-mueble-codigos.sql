-- MB1 · Token opaco por mueble para etiqueta escaneable.
-- La existencia de la fila = mueble liberado a producción (creado_en = fecha de liberación).
-- El token NUNCA se borra ni se regenera: reimprimir devuelve siempre el mismo.
CREATE TABLE IF NOT EXISTS mueble_codigos (
  id          bigserial PRIMARY KEY,
  codigo      text NOT NULL UNIQUE,          -- MB-000123
  proyecto_id text NOT NULL,                 -- proyectos_cache.id (pr_...)
  mf_id       text NOT NULL,                 -- id dentro del JSONB muebles (mf_4)
  creado_por  uuid REFERENCES empleados(id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proyecto_id, mf_id)
);

CREATE INDEX IF NOT EXISTS ix_mueble_codigos_proyecto ON mueble_codigos (proyecto_id);

-- Verificación (correr aparte):
-- SELECT count(*) FROM mueble_codigos;
