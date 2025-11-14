// ===============================
// FILE: Models/Clientes/MD_TB_Clientes.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 12 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'clientes'.
 * - Índices en barrio y estado.
 * - Scopes útiles (activos) y orden por nombre.
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const ClientesModel = db.define(
  'clientes',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING(120),
      allowNull: false,
      validate: {
        len: {
          args: [1, 120],
          msg: 'El nombre debe tener entre 1 y 120 caracteres.'
        }
      }
    },
    documento: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: 'uq_clientes_documento',
      validate: {
        len: { args: [0, 20], msg: 'Documento: máximo 20 caracteres.' }
      }
    },
    telefono: {
      type: DataTypes.STRING(30),
      allowNull: true,
      validate: {
        len: { args: [0, 30], msg: 'Teléfono: máximo 30 caracteres.' }
      }
    },
    email: {
      type: DataTypes.STRING(120),
      allowNull: true,
      validate: {
        isEmail: { args: true, msg: 'Email inválido.' },
        len: { args: [0, 120], msg: 'Email: máximo 120 caracteres.' }
      }
    },

    // FK → barrios (asociaciones se definirán por fuera)
    barrio_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },

    direccion_calle: {
      type: DataTypes.STRING(120),
      allowNull: true,
      validate: {
        len: { args: [0, 120], msg: 'Calle: máximo 120 caracteres.' }
      }
    },
    direccion_numero: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        len: { args: [0, 20], msg: 'Número: máximo 20 caracteres.' }
      }
    },
    direccion_piso_dpto: {
      type: DataTypes.STRING(40),
      allowNull: true,
      validate: {
        len: { args: [0, 40], msg: 'Piso/Dpto: máximo 40 caracteres.' }
      }
    },
    referencia: {
      type: DataTypes.STRING(180),
      allowNull: true,
      validate: {
        len: { args: [0, 180], msg: 'Referencia: máximo 180 caracteres.' }
      }
    },

    // Vendedor preferido (asignación por defecto)
    vendedor_preferido_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },

    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
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
      // El ON UPDATE CURRENT_TIMESTAMP lo maneja MySQL; Sequelize actualizará este campo en updates.
    }
  },
  {
    tableName: 'clientes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,

    defaultScope: {
      order: [['nombre', 'ASC']]
    },
    scopes: {
      activos: { where: { estado: 'activo' } }
    },

    indexes: [
      { name: 'uq_clientes_documento', unique: true, fields: ['documento'] },
      { name: 'idx_clientes_barrio', fields: ['barrio_id'] },
      { name: 'idx_clientes_estado', fields: ['estado'] }
    ]
  }
);

export default ClientesModel;
