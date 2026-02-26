// ===============================
// FILE: Models/CuentasCorriente/MD_TB_CxcMovimientos.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'cxc_movimientos' (libro mayor de CxC).
 * - Scopes útiles (deCliente, debe, haber, porTipo) y orden por fecha DESC.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const CxcMovimientosModel = db.define(
  'cxc_movimientos',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },

    // FK → clientes (asociaciones se agregarán luego)
    cliente_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },

    fecha: {
      type: DataTypes.DATE, // DATETIME
      allowNull: false
    },

    signo: {
      type: DataTypes.TINYINT, // 1 = DEBE ; -1 = HABER
      allowNull: false,
      comment: '1 = DEBE (aumenta deuda) ; -1 = HABER (pago/NC reduce)',
      validate: {
        isInt: { args: true, msg: 'signo debe ser entero.' },
        isIn: {
          args: [[1, -1]],
          msg: 'signo debe ser 1 (DEBE) o -1 (HABER).'
        }
      },
      get() {
        const v = this.getDataValue('signo');
        return v == null ? v : Number(v);
      }
    },

    monto: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      validate: {
        isDecimal: { args: true, msg: 'monto debe ser decimal.' },
        min: { args: [0], msg: 'monto no puede ser negativo.' }
      },
      get() {
        const v = this.getDataValue('monto');
        return v == null ? v : Number(v);
      }
    },

    origen_tipo: {
      type: DataTypes.ENUM(
        'venta',
        'cobranza',
        'ajuste',
        'nota_credito',
        'nota_debito',
        'saldo_previo' // Benjamin Orellana - 24-02-2026 se adiciona “cargar saldo previo”
      ),
      allowNull: false
    },

    origen_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true // puede ser null (e.g., ajustes manuales sin id concreto)
    },

    descripcion: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        len: { args: [0, 255], msg: 'Descripción: máx. 255 caracteres.' }
      }
    },

    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: db.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  },
  {
    tableName: 'cxc_movimientos',
    timestamps: false, // Solo created_at en DDL
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
      debe: { where: { signo: 1 } },
      haber: { where: { signo: -1 } },
      porTipo(tipo) {
        return { where: { origen_tipo: tipo } };
      }
    },

    indexes: [
      { name: 'idx_cxc_cliente_fecha', fields: ['cliente_id', 'fecha'] },
      {
        name: 'uq_cxc_origen',
        unique: true,
        fields: ['origen_tipo', 'origen_id']
      }
    ]
  }
);

export default CxcMovimientosModel;
