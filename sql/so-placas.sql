CREATE TABLE IF NOT EXISTS so_placas (
  so_numero      text PRIMARY KEY,
  so_zoho_id     text NOT NULL,
  proyecto_id    text,
  cf_mueble      text,
  cf_obra        text,
  fecha          date,
  placas_total   numeric NOT NULL DEFAULT 0,
  lineas         jsonb   NOT NULL DEFAULT '[]'::jsonb,
  sync_at        timestamptz NOT NULL DEFAULT now(),
  sync_error     text
);
ALTER TABLE so_placas ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_so_placas_proyecto ON so_placas(proyecto_id);
