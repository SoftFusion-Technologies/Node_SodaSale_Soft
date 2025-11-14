// ===============================
// FILE: Models/CuentasCorriente/MD_TB_CxcSaldosMensuales.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'cxc_saldos_mensuales'.
 * - Scopes útiles (deCliente, dePeriodo, delAnio) y orden por año/mes DESC.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const CxcSaldosMensualesModel = db.define(
  'cxc_saldos_mensuales',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FK → clientes (asociaciones se configurarán luego)
    cliente_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },

    anio: {
      type: DataTypes.SMALLINT, // YEAR lógico
      allowNull: false,
      validate: {
        isInt: { args: true, msg: 'anio debe ser entero.' }
      }
    },

    mes: {
      type: DataTypes.TINYINT,
      allowNull: false,
      validate: {
        isInt: { args: true, msg: 'mes debe ser entero.' },
        min: { args: [1], msg: 'mes debe estar entre 1 y 12.' },
        max: { args: [12], msg: 'mes debe estar entre 1 y 12.' }
      }
    },

    saldo_inicial: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('saldo_inicial');
        return v == null ? v : Number(v);
      }
    },

    debitos: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        isDecimal: { args: true, msg: 'debitos debe ser decimal.' },
        min: { args: [0], msg: 'debitos no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('debitos');
        return v == null ? v : Number(v);
      }
    },

    creditos: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        isDecimal: { args: true, msg: 'creditos debe ser decimal.' },
        min: { args: [0], msg: 'creditos no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('creditos');
        return v == null ? v : Number(v);
      }
    },

    saldo_final: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      get() {
        const v = this.getDataValue('saldo_final');
        return v == null ? v : Number(v);
      }
    },

    cierre_fecha: {
      type: DataTypes.DATE, // DATETIME
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  },
  {
    tableName: 'cxc_saldos_mensuales',
    timestamps: false, // DDL no define updated_at
    underscored: true,

    defaultScope: {
      order: [
        ['anio', 'DESC'],
        ['mes', 'DESC'],
        ['cliente_id', 'ASC']
      ]
    },
    scopes: {
      deCliente(clienteId) {
        return { where: { cliente_id: clienteId } };
      },
      dePeriodo(anio, mes) {
        const where = {};
        if (anio != null) where.anio = anio;
        if (mes != null) where.mes = mes;
        return { where };
      },
      delAnio(anio) {
        return { where: { anio } };
      }
    },

    indexes: [
      {
        name: 'uq_cxcsal_cliente_mes',
        unique: true,
        fields: ['cliente_id', 'anio', 'mes']
      },
      { name: 'idx_cxcsal_mes', fields: ['anio', 'mes'] }
    ]
  }
);

export default CxcSaldosMensualesModel;
