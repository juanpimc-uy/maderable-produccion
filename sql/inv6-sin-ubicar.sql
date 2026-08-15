-- Zona donde caen las placas recién dadas de alta, pendientes de ordenar
INSERT INTO inv_ubicaciones (codigo, nombre, tipo, parent_id, activo)
VALUES ('SIN-UBICAR', 'Sin ubicar — pendiente de ordenar', 'zona', NULL, true)
ON CONFLICT DO NOTHING;
