// ===============================================
// FILE: Models/relacionesVentasCxC.js
// ===============================================
/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Concentra las asociaciones núcleo de Ventas + CxC + Cobranzas:
 *
 * Geografía / Zona:
 * - Clientes N..1 Barrios  (clientes.barrio_id)  → Para reportes por zona.
 *
 * Ventas:
 * - Clientes 1..N Ventas   (ventas.cliente_id)
 * - Vendedores 1..N Ventas (ventas.vendedor_id)
 * - Ventas 1..N VentasDetalle (ventas_detalle.venta_id)
 * - Productos 1..N VentasDetalle (ventas_detalle.producto_id)
 *
 * Cobranzas:
 * - Clientes 1..N CobranzasClientes (cobranzas_clientes.cliente_id)
 * - Vendedores 1..N CobranzasClientes (cobranzas_clientes.vendedor_id) [opcional]
 * - CobranzasClientes 1..N CobranzaAplicaciones (cobranza_aplicaciones.cobranza_id)
 * - Ventas 1..N CobranzaAplicaciones (cobranza_aplicaciones.venta_id) [venta puede ser NULL → crédito no aplicado]
 *
 * Cuenta Corriente:
 * - Clientes 1..N CxcMovimientos (cxc_movimientos.cliente_id)
 * - Clientes 1..N CxcSaldosMensuales (cxc_saldos_mensuales.cliente_id)
 *
 * Nota vendedor por cobertura:
 * - La sugerencia de vendedor por zona se toma del histórico vendedor_barrios vigente a la fecha (se arma en otro archivo).
 */

import { ClientesModel } from './Clientes/MD_TB_Clientes.js';
import { VentasModel } from './Ventas/MD_TB_Ventas.js';
import { VentasDetalleModel } from './Ventas/MD_TB_VentasDetalle.js';
import { CobranzasClientesModel } from './Cobranzas/MD_TB_CobranzasClientes.js';
import { CobranzaAplicacionesModel } from './Cobranzas/MD_TB_CobranzaAplicaciones.js';
import { CxcMovimientosModel } from './CuentasCorriente/MD_TB_CxcMovimientos.js';
import { CxcSaldosMensualesModel } from './CuentasCorriente/MD_TB_CxcSaldosMensuales.js';
import { VendedoresModel } from './Vendedores/MD_TB_Vendedores.js';
import { BarriosModel } from './Geografia/MD_TB_Barrios.js';
// Opcional (pero recomendado para Detalle de Venta):
import { ProductosModel } from './Productos/MD_TB_Productos.js';

export function initRelacionesVentasCxC() {
  // ===============================
  // Geografía / Zona
  // ===============================
  ClientesModel.belongsTo(BarriosModel, {
    as: 'barrio',
    foreignKey: 'barrio_id'
  });
  BarriosModel.hasMany(ClientesModel, {
    as: 'clientes',
    foreignKey: 'barrio_id'
  });

  // ===============================
  // Ventas (cabecera)
  // ===============================
  ClientesModel.hasMany(VentasModel, {
    as: 'ventas',
    foreignKey: 'cliente_id'
  });
  VentasModel.belongsTo(ClientesModel, {
    as: 'cliente',
    foreignKey: 'cliente_id'
  });

  VendedoresModel.hasMany(VentasModel, {
    as: 'ventas',
    foreignKey: 'vendedor_id'
  });
  VentasModel.belongsTo(VendedoresModel, {
    as: 'vendedor',
    foreignKey: 'vendedor_id'
  });

  // ===============================
  // Ventas Detalle
  // ===============================
  VentasModel.hasMany(VentasDetalleModel, {
    as: 'items',
    foreignKey: 'venta_id',
    onDelete: 'CASCADE'
  });
  VentasDetalleModel.belongsTo(VentasModel, {
    as: 'venta',
    foreignKey: 'venta_id'
  });

  // Producto ↔ Detalle de Venta (si el módulo de productos está presente)
  if (ProductosModel) {
    ProductosModel.hasMany(VentasDetalleModel, {
      as: 'detalles_venta',
      foreignKey: 'producto_id'
    });
    VentasDetalleModel.belongsTo(ProductosModel, {
      as: 'producto',
      foreignKey: 'producto_id'
    });
  }

  // ===============================
  // Cobranzas
  // ===============================
  ClientesModel.hasMany(CobranzasClientesModel, {
    as: 'cobranzas',
    foreignKey: 'cliente_id'
  });
  CobranzasClientesModel.belongsTo(ClientesModel, {
    as: 'cliente',
    foreignKey: 'cliente_id'
  });

  VendedoresModel.hasMany(CobranzasClientesModel, {
    as: 'cobranzas',
    foreignKey: 'vendedor_id'
  });
  CobranzasClientesModel.belongsTo(VendedoresModel, {
    as: 'vendedor',
    foreignKey: 'vendedor_id'
  });

  CobranzasClientesModel.hasMany(CobranzaAplicacionesModel, {
    as: 'aplicaciones',
    foreignKey: 'cobranza_id',
    onDelete: 'CASCADE'
  });
  CobranzaAplicacionesModel.belongsTo(CobranzasClientesModel, {
    as: 'cobranza',
    foreignKey: 'cobranza_id'
  });

  VentasModel.hasMany(CobranzaAplicacionesModel, {
    as: 'aplicaciones',
    foreignKey: 'venta_id'
  });
  CobranzaAplicacionesModel.belongsTo(VentasModel, {
    as: 'venta',
    foreignKey: 'venta_id'
  });

  // ===============================
  // Cuenta Corriente
  // ===============================
  ClientesModel.hasMany(CxcMovimientosModel, {
    as: 'cxc_movimientos',
    foreignKey: 'cliente_id'
  });
  CxcMovimientosModel.belongsTo(ClientesModel, {
    as: 'cliente',
    foreignKey: 'cliente_id'
  });

  ClientesModel.hasMany(CxcSaldosMensualesModel, {
    as: 'cxc_saldos',
    foreignKey: 'cliente_id'
  });
  CxcSaldosMensualesModel.belongsTo(ClientesModel, {
    as: 'cliente',
    foreignKey: 'cliente_id'
  });
}

ClientesModel.belongsTo(VendedoresModel, {
  as: 'vendedor_preferido',
  foreignKey: 'vendedor_preferido_id'
});
VendedoresModel.hasMany(ClientesModel, {
  as: 'clientes_preferidos',
  foreignKey: 'vendedor_preferido_id'
});
export default initRelacionesVentasCxC;
