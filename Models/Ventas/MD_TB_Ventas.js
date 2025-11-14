// ===============================
// FILE: Models/Ventas/MD_TB_Ventas.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'ventas' (cabecera).
 * - Scopes útiles (confirmadas/anuladas) y orden por fecha DESC.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const VentasModel = db.define(
  'ventas',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FKs (asociaciones se agregan luego)
    cliente_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    vendedor_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },

    fecha: {
      type: DataTypes.DATE, // DATETIME
      allowNull: false
    },

    tipo: {
      type: DataTypes.ENUM('contado', 'fiado', 'a_cuenta'),
      allowNull: false,
      defaultValue: 'fiado'
    },

    total_neto: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'total_neto debe ser decimal.' },
        min: { args: [0], msg: 'total_neto no puede ser negativo.' }
      }
    },

    observaciones: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        len: { args: [0, 255], msg: 'Observaciones: máx. 255 caracteres.' }
      }
    },

    estado: {
      type: DataTypes.ENUM('confirmada', 'anulada'),
      allowNull: false,
      defaultValue: 'confirmada'
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
      // ON UPDATE CURRENT_TIMESTAMP lo maneja MySQL; Sequelize actualizará este campo en updates.
    }
  },
  {
    tableName: 'ventas',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,

    defaultScope: {
      order: [
        ['fecha', 'DESC'],
        ['id', 'DESC']
      ]
    },
    scopes: {
      confirmadas: { where: { estado: 'confirmada' } },
      anuladas: { where: { estado: 'anulada' } }
    },

    indexes: [
      { name: 'idx_ventas_cliente_fecha', fields: ['cliente_id', 'fecha'] },
      { name: 'idx_ventas_vendedor_fecha', fields: ['vendedor_id', 'fecha'] },
      { name: 'idx_ventas_tipo_estado', fields: ['tipo', 'estado'] }
    ]
  }
);

export default VentasModel;
