// ===============================
// FILE: Models/Cobranzas/MD_TB_CobranzasClientes.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'cobranzas_clientes' (cabecera).
 * - Sin asociaciones aquí (se definirán aparte).
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const CobranzasClientesModel = db.define(
  'cobranzas_clientes',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FKs (asociaciones se configurarán aparte)
    cliente_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    vendedor_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },

    fecha: {
      type: DataTypes.DATE, // DATETIME
      allowNull: false
    },

    total_cobrado: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'total_cobrado debe ser decimal.' },
        min: { args: [0], msg: 'total_cobrado no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('total_cobrado');
        return v == null ? v : Number(v);
      }
    },

    observaciones: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        len: { args: [0, 255], msg: 'Observaciones: máx. 255 caracteres.' }
      }
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
    tableName: 'cobranzas_clientes',
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
      deCliente(clienteId) {
        return { where: { cliente_id: clienteId } };
      },
      conVendedor(vendedorId) {
        return { where: { vendedor_id: vendedorId } };
      },
      rangoFechas(desde, hasta) {
        const where = {};
        if (desde)
          where.fecha = {
            ...(where.fecha || {}),
            [db.Sequelize.Op.gte]: desde
          };
        if (hasta)
          where.fecha = {
            ...(where.fecha || {}),
            [db.Sequelize.Op.lte]: hasta
          };
        return { where };
      }
    },

    indexes: [
      { name: 'idx_cob_cliente_fecha', fields: ['cliente_id', 'fecha'] }
    ]
  }
);

export default CobranzasClientesModel;
