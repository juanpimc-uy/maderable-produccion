-- ============================================================
-- MAD-1 · Schema Módulo Madera
-- Requiere: /sql/mad1-pre-alters-lote6.sql ejecutado antes
-- ============================================================

-- === Especies ===
CREATE TABLE madera_especies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL UNIQUE,
  nombre_corto TEXT NOT NULL,
  observaciones TEXT,
  archivado BOOLEAN NOT NULL DEFAULT false,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO madera_especies (nombre, nombre_corto) VALUES
  ('Lapacho', 'LAP'), ('Cedro', 'CED'), ('Petiribí', 'PET'),
  ('Eucalyptus grandis', 'EUC'), ('Anchico', 'ANC'), ('Pino Elliotis', 'PIN');

-- === Espesores (catálogo editable) ===
CREATE TABLE madera_espesores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  valor NUMERIC(6,3) NOT NULL,
  unidad TEXT NOT NULL CHECK (unidad IN ('pulgadas', 'cm')),
  descripcion TEXT,
  archivado BOOLEAN NOT NULL DEFAULT false,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (valor, unidad)
);

INSERT INTO madera_espesores (valor, unidad, descripcion) VALUES
  (1, 'pulgadas', '1 pulgada'),
  (1.5, 'pulgadas', '1.5 pulgadas'),
  (2, 'pulgadas', '2 pulgadas'),
  (3, 'pulgadas', '3 pulgadas'),
  (2.5, 'cm', '2.5 cm'),
  (5, 'cm', '5 cm');

-- === Partidas ===
CREATE SEQUENCE madera_partida_numero_seq START 1;

CREATE TABLE madera_partidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero INTEGER NOT NULL UNIQUE DEFAULT nextval('madera_partida_numero_seq'),
  estado TEXT NOT NULL DEFAULT 'esperada'
    CHECK (estado IN ('esperada', 'pendiente_factura', 'activa', 'archivada')),

  especie_id UUID NOT NULL REFERENCES madera_especies(id),
  espesor_id UUID NOT NULL REFERENCES madera_espesores(id),

  proveedor_zoho_id TEXT,
  proveedor_nombre TEXT NOT NULL,

  cantidad_aproximada_pies NUMERIC(12,2),
  fecha_esperada DATE,
  notas_recepcion TEXT,

  pies_romaneados NUMERIC(12,3),
  romaneada_por UUID REFERENCES empleados(id),
  romaneada_en TIMESTAMPTZ,

  factura_numero TEXT,
  factura_fecha DATE,
  pies_facturados NUMERIC(12,3),
  costo_total_usd NUMERIC(12,2),
  costo_por_pie_usd NUMERIC(12,4),
  discrepancia_pies NUMERIC(12,3),
  factura_cargada_por UUID REFERENCES empleados(id),
  factura_cargada_en TIMESTAMPTZ,

  motivo_carga_inicial TEXT,
  motivo_archivo TEXT,
  archivada_en TIMESTAMPTZ,

  creada_por UUID NOT NULL REFERENCES empleados(id),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_madera_partidas_estado ON madera_partidas(estado);
CREATE INDEX idx_madera_partidas_especie ON madera_partidas(especie_id);
CREATE INDEX idx_madera_partidas_espesor ON madera_partidas(espesor_id);

-- === Piezas ===
CREATE TABLE madera_piezas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partida_id UUID NOT NULL REFERENCES madera_partidas(id) ON DELETE RESTRICT,
  numero_pieza TEXT NOT NULL,

  ancho_cm NUMERIC(8,2) NOT NULL,
  largo_cm NUMERIC(8,2) NOT NULL,
  espesor_cm NUMERIC(6,3) NOT NULL,
  pies_maderero NUMERIC(10,3) NOT NULL,

  costo_pieza_usd NUMERIC(10,2),

  estado TEXT NOT NULL DEFAULT 'en_stock'
    CHECK (estado IN ('en_stock', 'reservada', 'consumida', 'descartada')),

  proyecto_id UUID REFERENCES proyectos_cache(id),
  mueble_id TEXT,
  reservada_por UUID REFERENCES empleados(id),
  reservada_en TIMESTAMPTZ,
  consumida_por UUID REFERENCES empleados(id),
  consumida_en TIMESTAMPTZ,
  consumida_en_tarea UUID REFERENCES registros_trabajo(id),

  qr_codigo TEXT NOT NULL,
  ubicacion TEXT,
  etiqueta_impresa BOOLEAN NOT NULL DEFAULT false,
  observaciones TEXT,

  UNIQUE (partida_id, numero_pieza)
);

CREATE INDEX idx_madera_piezas_partida ON madera_piezas(partida_id);
CREATE INDEX idx_madera_piezas_estado ON madera_piezas(estado);
CREATE INDEX idx_madera_piezas_proyecto ON madera_piezas(proyecto_id) WHERE proyecto_id IS NOT NULL;
CREATE INDEX idx_madera_piezas_qr ON madera_piezas(qr_codigo);
CREATE INDEX idx_madera_piezas_impresion ON madera_piezas(etiqueta_impresa) WHERE etiqueta_impresa = false;

-- === Movimientos ===
CREATE TABLE madera_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pieza_id UUID NOT NULL REFERENCES madera_piezas(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'ingreso', 'alta_factura', 'reserva', 'liberacion_reserva',
    'consumo', 'descarte', 'impresion_etiqueta'
  )),
  proyecto_id UUID REFERENCES proyectos_cache(id),
  mueble_id TEXT,
  monto_usd NUMERIC(10,2),
  pies NUMERIC(10,3),
  realizado_por UUID NOT NULL REFERENCES empleados(id),
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas TEXT
);

CREATE INDEX idx_madera_movimientos_pieza ON madera_movimientos(pieza_id);
CREATE INDEX idx_madera_movimientos_proyecto ON madera_movimientos(proyecto_id) WHERE proyecto_id IS NOT NULL;

-- === FK final costos_directos_proyecto → madera_movimientos ===
ALTER TABLE costos_directos_proyecto
  ADD CONSTRAINT fk_movimiento_madera
  FOREIGN KEY (movimiento_madera_id) REFERENCES madera_movimientos(id);

-- === RLS off (patrón del proyecto: service role key + /api gateway) ===
ALTER TABLE madera_especies DISABLE ROW LEVEL SECURITY;
ALTER TABLE madera_espesores DISABLE ROW LEVEL SECURITY;
ALTER TABLE madera_partidas DISABLE ROW LEVEL SECURITY;
ALTER TABLE madera_piezas DISABLE ROW LEVEL SECURITY;
ALTER TABLE madera_movimientos DISABLE ROW LEVEL SECURITY;
