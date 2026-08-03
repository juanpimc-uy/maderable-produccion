-- El ajuste puede registrar valor 0 (conteo a cero); relajar el CHECK de la tabla
ALTER TABLE inv_movimientos DROP CONSTRAINT inv_movimientos_cantidad_check;
ALTER TABLE inv_movimientos ADD CONSTRAINT inv_movimientos_cantidad_check
  CHECK (cantidad > 0 OR tipo = 'ajuste');

-- RPC transaccional: inserta movimiento + actualiza stock en una transacción.
-- El stock NUNCA se toca fuera de esta función.
--
-- Nota semántica del ajuste: el movimiento de tipo 'ajuste' guarda en cantidad
-- el VALOR NUEVO del bin (no un delta), y el backend arma la nota con "conteo: X→Y".
-- Es la única excepción a "cantidad = magnitud movida".

CREATE OR REPLACE FUNCTION inv_registrar_movimiento(
  p_tipo TEXT, p_item_id BIGINT, p_ubicacion_id BIGINT,
  p_ubicacion_destino_id BIGINT, p_cantidad NUMERIC,
  p_proyecto_id TEXT, p_mueble_id TEXT, p_motivo TEXT,
  p_origen TEXT, p_empleado_id INTEGER, p_nota TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id BIGINT;
BEGIN
  IF p_tipo = 'ajuste' THEN
    IF p_cantidad < 0 THEN RAISE EXCEPTION 'ajuste no puede ser negativo'; END IF;
  ELSIF p_cantidad <= 0 THEN RAISE EXCEPTION 'cantidad debe ser > 0'; END IF;

  INSERT INTO inv_movimientos (tipo, item_id, ubicacion_id, ubicacion_destino_id,
    cantidad, proyecto_id, mueble_id, motivo, origen, empleado_id, nota)
  VALUES (p_tipo, p_item_id, p_ubicacion_id, p_ubicacion_destino_id,
    p_cantidad, p_proyecto_id, p_mueble_id, p_motivo, p_origen, p_empleado_id, p_nota)
  RETURNING id INTO v_id;

  IF p_tipo = 'entrada' THEN
    INSERT INTO inv_stock (item_id, ubicacion_id, cantidad, actualizado_en)
    VALUES (p_item_id, p_ubicacion_id, p_cantidad, NOW())
    ON CONFLICT (item_id, ubicacion_id)
    DO UPDATE SET cantidad = inv_stock.cantidad + p_cantidad, actualizado_en = NOW();
  ELSIF p_tipo = 'salida' THEN
    UPDATE inv_stock SET cantidad = cantidad - p_cantidad, actualizado_en = NOW()
    WHERE item_id = p_item_id AND ubicacion_id = p_ubicacion_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'sin stock en la ubicación'; END IF;
  ELSIF p_tipo = 'traslado' THEN
    UPDATE inv_stock SET cantidad = cantidad - p_cantidad, actualizado_en = NOW()
    WHERE item_id = p_item_id AND ubicacion_id = p_ubicacion_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'sin stock en la ubicación de origen'; END IF;
    INSERT INTO inv_stock (item_id, ubicacion_id, cantidad, actualizado_en)
    VALUES (p_item_id, p_ubicacion_destino_id, p_cantidad, NOW())
    ON CONFLICT (item_id, ubicacion_id)
    DO UPDATE SET cantidad = inv_stock.cantidad + p_cantidad, actualizado_en = NOW();
  ELSIF p_tipo = 'ajuste' THEN
    INSERT INTO inv_stock (item_id, ubicacion_id, cantidad, actualizado_en)
    VALUES (p_item_id, p_ubicacion_id, p_cantidad, NOW())
    ON CONFLICT (item_id, ubicacion_id)
    DO UPDATE SET cantidad = p_cantidad, actualizado_en = NOW();
  ELSE
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;
  RETURN v_id;
END $$;
