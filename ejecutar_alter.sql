use DB_SodaSaleDESA_10112025;

-- NUEVO ALTER 
ALTER TABLE cxc_movimientos
MODIFY COLUMN origen_tipo ENUM(
  'venta',
  'cobranza',
  'ajuste',
  'nota_credito',
  'nota_debito',
  'saldo_previo'
) NOT NULL;

-- Benjamin Orellana - 25-02-2026 - aplicaciones con venta_id NULL (SALDO_PREVIO vs CREDITO)
ALTER TABLE cobranza_aplicaciones
  ADD COLUMN aplica_a VARCHAR(20) NULL AFTER venta_id;

-- Benjamin Orellana - 25-02-2026 - todo lo existente con venta_id NULL pasa a ser CREDITO (no podemos inferir SALDO_PREVIO retroactivamente)
UPDATE cobranza_aplicaciones
SET aplica_a = 'CREDITO'
WHERE venta_id IS NULL AND (aplica_a IS NULL OR aplica_a = '');

ALTER TABLE cobranza_aplicaciones
  ADD CONSTRAINT cobranza_aplicaciones_chk_aplica_a
  CHECK (aplica_a IS NULL OR aplica_a IN ('CREDITO','SALDO_PREVIO'));

CREATE INDEX idx_app_null_aplica_a ON cobranza_aplicaciones (venta_id, aplica_a, cobranza_id);

-- NUEVO ALTER 
ALTER TABLE ventas_detalle
  DROP FOREIGN KEY fk_vdet_producto;

ALTER TABLE ventas_detalle
  ADD CONSTRAINT fk_vdet_producto
  FOREIGN KEY (producto_id) REFERENCES productos(id)
  ON DELETE CASCADE;

-- Benjamin Orellana - 16-01-2026
-- Agrega ciudad_id para exigir "Ciudad" sin depender de barrio/localidad.

ALTER TABLE clientes
  ADD COLUMN ciudad_id INT UNSIGNED NULL AFTER email,
  ADD KEY idx_clientes_ciudad (ciudad_id),
  ADD CONSTRAINT fk_clientes_ciudad
    FOREIGN KEY (ciudad_id) REFERENCES ciudades(id);
-- resulta que estabamos guardando la cantidad en decimales
ALTER TABLE ventas_detalle
  MODIFY cantidad INT UNSIGNED NOT NULL;

-- ======================================================
-- Benjamin Orellana - 17-01-2026
-- Agregar reparto_id a ventas para poder filtrar por reparto
-- ======================================================

ALTER TABLE ventas
  ADD COLUMN reparto_id INT UNSIGNED NULL AFTER vendedor_id;

ALTER TABLE ventas
  ADD KEY idx_ventas_reparto_fecha (reparto_id, fecha);

ALTER TABLE ventas
  ADD CONSTRAINT fk_ventas_reparto
    FOREIGN KEY (reparto_id) REFERENCES repartos(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
