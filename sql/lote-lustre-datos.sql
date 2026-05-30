-- ══════════════════════════════
-- 1. ACTUALIZAR CATEGORÍAS Y PRECIOS DE INTERIOR EN ITEMS EXISTENTES
-- ══════════════════════════════

UPDATE lustre_tipos SET categoria='LUSTRE',
  precio_interior_visto=25, precio_interior_no_visto=10
  WHERE nombre='LUSTRE 5%';

UPDATE lustre_tipos SET categoria='LUSTRE' WHERE nombre IN
  ('LUSTRE EMP.','LUSTRE CON TINTA','HYDROCROM','CANTOS',
   'LUSTRE PORO ABIERTO','LITRO DE PINTURA COLOR',
   'LITRO DE PINTURA - MINIMO POR COLOR',
   'LACA BLANCO','LACA COLOR >3m2',
   'LACA BLANCO RUTEADO','LACA COLOR RUTEADO');

UPDATE lustre_tipos SET categoria='PATINAS', precio_exterior=55
  WHERE nombre='OTRAS PATINAS';

UPDATE lustre_tipos SET categoria='MADERA PORO ABIERTO'
  WHERE nombre IN ('ROBLE PORO ABIERTO BLANCO','ROBLE PORO ABIERTO COLOR',
                   'ENCHAPADO ROBLE BLANCO','ENCHAPADO ROBLE COLOR');

UPDATE lustre_tipos SET categoria='ALUMINIOS-HIERROS'
  WHERE nombre='LACA METALIZADA BR 20';

UPDATE lustre_tipos SET categoria='BRILLANTES'
  WHERE nombre IN ('LACA MET. BR 100 S/PULIR','LACA MET. BR 100 PULIDO');

-- ══════════════════════════════
-- 2. INSERTAR NUEVOS ITEMS
-- Usar orden = (SELECT COALESCE(MAX(orden),0) FROM lustre_tipos) + N
-- donde N empieza en 1 e incrementa por cada insert
-- ══════════════════════════════

INSERT INTO lustre_tipos (nombre, categoria, precio_exterior, precio_interior_visto, precio_interior_no_visto, activo, orden) VALUES

-- LUSTRE
('LUSTRE NATURAL', 'LUSTRE', 33, 25, 10, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BLANQUEADO', 'LUSTRE', 55, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MELAMINICO BLANCO
('MELAMINICO LIJADO MAQUINA BCO', 'MELAMINICO BLANCO', 30, 25, 10, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO LISO BCO', 'MELAMINICO BLANCO', 35, 20, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO RANURADO BCO', 'MELAMINICO BLANCO', 45, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO REPLANADO BCO', 'MELAMINICO BLANCO', 55, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('CANTOS MELAMINICO BCO', 'MELAMINICO BLANCO', 4, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('ZOCALOS BCO', 'MELAMINICO BLANCO', 5, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MELAMINICO COLOR
('MELAMINICO LIJADO MAQUINA COLOR', 'MELAMINICO COLOR', 37, 32, 10, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO LISO COLOR', 'MELAMINICO COLOR', 42, 27, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO RANURADO COLOR', 'MELAMINICO COLOR', 52, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MELAMINICO REPLANADO COLOR', 'MELAMINICO COLOR', 62, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('CANTOS MELAMINICO COLOR', 'MELAMINICO COLOR', 5, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('ZOCALOS COLOR', 'MELAMINICO COLOR', 6, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MDF BLANCO
('MDF LISO BCO LIJADO MAQUINA', 'MDF BLANCO', 40, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF LISO BCO', 'MDF BLANCO', 45, 35, 10, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF RANURADO BCO', 'MDF BLANCO', 55, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF REPLANADO BCO', 'MDF BLANCO', 60, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('CANTOS MDF BCO', 'MDF BLANCO', 6, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MDF COLOR
('MDF LISO COLOR LIJADO MAQUINA', 'MDF COLOR', 47, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF LISO COLOR', 'MDF COLOR', 52, 40, 10, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF RANURADO COLOR', 'MDF COLOR', 62, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MDF REPLANADO COLOR', 'MDF COLOR', 67, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('CANTOS MDF COLOR', 'MDF COLOR', 7, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MACIZO
('MACIZO BLANCO', 'MACIZO', 55, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MACIZO COLOR', 'MACIZO', 62, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('MACIZO HYDROCROM COLOR', 'MACIZO', 45, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- MADERA PORO NATURAL
('ENCHAPADO ROBLE BLANCO PORO NAT.', 'MADERA PORO NATURAL', 40, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('ENCHAPADO ROBLE COLOR PORO NAT.', 'MADERA PORO NATURAL', 45, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- ALUMINIOS-HIERROS
('ALUMINIOS BLANCO', 'ALUMINIOS-HIERROS', 60, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('ALUMINIOS COLORES', 'ALUMINIOS-HIERROS', 67, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('ALUMINIOS METALIZADOS', 'ALUMINIOS-HIERROS', 72, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- BRILLANTES
('BRILLANTE MELAMINICO BCO PULIDO', 'BRILLANTES', 130, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MELAMINICO BCO S/PULIR', 'BRILLANTES', 80, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MELAMINICO COLOR PULIDO', 'BRILLANTES', 140, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MELAMINICO COLOR S/PULIR', 'BRILLANTES', 90, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MDF BCO PULIDO', 'BRILLANTES', 150, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MDF BCO S/PULIR', 'BRILLANTES', 100, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MDF COLOR PULIDO', 'BRILLANTES', 160, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE MDF COLOR S/PULIR', 'BRILLANTES', 110, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),

-- BRILLANTES LUSTRE
('BRILLANTE LUSTRE S/PULIR', 'BRILLANTES', 100, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos)),
('BRILLANTE LUSTRE PULIDO', 'BRILLANTES', 150, null, null, true,
  (SELECT COALESCE(MAX(orden),0)+1 FROM lustre_tipos));
