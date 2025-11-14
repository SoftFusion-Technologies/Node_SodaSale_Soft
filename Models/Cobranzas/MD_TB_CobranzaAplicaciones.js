// ===============================
// FILE: Models/Cobranzas/MD_TB_CobranzaAplicaciones.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'cobranza_aplicaciones'.
 * - 'venta_id' puede ser NULL → crédito no aplicado.
 * - Scopes útiles (deCobranza, deVenta, sinAplicar) y orden por cobranza_id/ID.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const CobranzaAplicacionesModel = db.define(
  'cobranza_aplicaciones',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FKs (asociaciones se definirán luego)
    cobranza_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    venta_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true // null => crédito no aplicado
    },

    monto_aplicado: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'monto_aplicado debe ser decimal.' },
        min: { args: [0], msg: 'monto_aplicado no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('monto_aplicado');
        return v == null ? v : Number(v);
      }
    }
  },
  {
    tableName: 'cobranza_aplicaciones',
    timestamps: false, // DDL no define created_at/updated_at
    underscored: true,

    defaultScope: {
      order: [
        ['cobranza_id', 'ASC'],
        ['id', 'ASC']
      ]
    },
    scopes: {
      deCobranza(cobranzaId) {
        return { where: { cobranza_id: cobranzaId } };
      },
      deVenta(ventaId) {
        return { where: { venta_id: ventaId } };
      },
      sinAplicar() {
        return { where: { venta_id: { [db.Sequelize.Op.is]: null } } };
      }
    },

    indexes: [{ name: 'idx_app_cobranza', fields: ['cobranza_id'] }]
  }
);

export default CobranzaAplicacionesModel;
