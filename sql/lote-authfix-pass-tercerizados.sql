-- Lote Auth-Fix: password de tercerizados en config_global
-- REEMPLAZAR <<PONER_PASSWORD_NUEVA_AQUI>> por la password real antes de ejecutar.
INSERT INTO config_global (clave, valor, actualizado_at)
VALUES ('pass_tercerizados', '"<<PONER_PASSWORD_NUEVA_AQUI>>"'::jsonb, now())
ON CONFLICT (clave) DO UPDATE
SET valor = '"<<PONER_PASSWORD_NUEVA_AQUI>>"'::jsonb,
    actualizado_at = now();
