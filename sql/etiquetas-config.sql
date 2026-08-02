CREATE TABLE IF NOT EXISTS etiquetas_config (
  funcion         text PRIMARY KEY,
  tamano          text NOT NULL DEFAULT '60x30' CHECK (tamano IN ('60x30','100x50')),
  titulo          text,
  campos          jsonb NOT NULL DEFAULT '{}'::jsonb,
  actualizado_at  timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid
);
ALTER TABLE etiquetas_config ENABLE ROW LEVEL SECURITY;
