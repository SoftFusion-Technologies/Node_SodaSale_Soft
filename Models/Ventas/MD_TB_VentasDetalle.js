// ===============================
// FILE: Models/Ventas/MD_TB_VentasDetalle.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'ventas_detalle'.
 * - 'subtotal' es columna GENERADA (VIRTUAL) en MySQL, solo lectura.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const VentasDetalleModel = db.define(
  'ventas_detalle',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FKs (asociaciones se agregarán más adelante)
    venta_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    producto_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },

    cantidad: {
      type: DataTypes.DECIMAL(12, 3),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'cantidad debe ser decimal.' },
        min: { args: [0.001], msg: 'cantidad debe ser > 0.' }
      },
      get() {
        const v = this.getDataValue('cantidad');
        return v == null ? v : Number(v);
      }
    },

    precio_unit: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'precio_unit debe ser decimal.' },
        min: { args: [0], msg: 'precio_unit no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('precio_unit');
        return v == null ? v : Number(v);
      }
    },

    // Columna generada en MySQL: ROUND(cantidad * precio_unit, 2)
    // La definimos como DECIMAL para poder leerla en SELECTs; no se debe setear manualmente.
    subtotal: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue('subtotal');
        return v == null ? v : Number(v);
      }
      // Nota: no definir setter; es calculada por MySQL.
    }
  },
  {
    tableName: 'ventas_detalle',
    timestamps: false, // DDL no define created_at/updated_at
    underscored: true,

    defaultScope: {
      order: [['id', 'ASC']]
    },
    scopes: {
      // Ej: VentasDetalleModel.scope({ method: ['deVenta', 123] }).findAll()
      deVenta(ventaId) {
        return { where: { venta_id: ventaId } };
      }
    },

    indexes: [{ name: 'idx_vdet_venta', fields: ['venta_id'] }]
  }
);

export default VentasDetalleModel;
