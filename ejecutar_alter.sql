use DB_SodaSaleDESA_10112025;

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
