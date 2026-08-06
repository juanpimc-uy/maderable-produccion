-- INV-3b: recepción serializada (placa/madera) — secuencia + RPC transaccional

-- Columna unidad_id en movimientos (para trazabilidad de serializados)
ALTER TABLE inv_movimientos
  ADD COLUMN IF NOT EXISTS unidad_id BIGINT REFERENCES inv_unidades(id);

-- Secuencia global de unidades serializadas (PL-000001, PL-000002, …)
CREATE SEQUENCE IF NOT EXISTS inv_unidad_seq START 1;

-- Recibe una línea serializada: crea N unidades + N movimientos de entrada, en una transacción.
-- Cada unidad con su costo congelado (USD) y verificado. Devuelve los códigos generados.
CREATE OR REPLACE FUNCTION inv_recibir_serializado(
  p_item_id BIGINT, p_cantidad INT, p_ubicacion_id BIGINT,
  p_costo_usd NUMERIC, p_atributos JSONB, p_empleado_id INTEGER,
  p_reserva_proyecto_id TEXT, p_oc_numero TEXT
) RETURNS TEXT[]
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_codigos TEXT[] := '{}';
  v_cod TEXT; v_uid BIGINT; i INT;
BEGIN
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'cantidad debe ser > 0'; END IF;
  FOR i IN 1..p_cantidad LOOP
    v_cod := 'PL-' || lpad(nextval('inv_unidad_seq')::text, 6, '0');
    INSERT INTO inv_unidades (item_id, codigo, atributos, ubicacion_id, estado,
      costo_usd, reserva_proyecto_id, creado_por, creado_en)
    VALUES (p_item_id, v_cod, p_atributos, p_ubicacion_id, 'activa',
      p_costo_usd, p_reserva_proyecto_id, p_empleado_id, NOW())
    RETURNING id INTO v_uid;

    -- Movimiento de entrada + actualizar stock
    INSERT INTO inv_movimientos (tipo, item_id, ubicacion_id, cantidad,
      unidad_id, motivo, origen, empleado_id, costo_unitario_usd, costo_verificado, nota)
    VALUES ('entrada', p_item_id, p_ubicacion_id, 1,
      v_uid, 'recepcion_oc', 'recepcion', p_empleado_id, p_costo_usd, true,
      'OC ' || COALESCE(p_oc_numero,''));

    INSERT INTO inv_stock (item_id, ubicacion_id, cantidad, actualizado_en)
    VALUES (p_item_id, p_ubicacion_id, 1, NOW())
    ON CONFLICT (item_id, ubicacion_id)
    DO UPDATE SET cantidad = inv_stock.cantidad + 1, actualizado_en = NOW();

    v_codigos := array_append(v_codigos, v_cod);
  END LOOP;
  RETURN v_codigos;
END $$;
