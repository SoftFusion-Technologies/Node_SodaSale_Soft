// ===============================
// FILE: Models/Vendedores/MD_TB_Vendedores.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Modelo Sequelize para la tabla 'vendedores'.
 * - Respeta DDL (campos, defaults y unique por documento/email).
 * - Índices en nombre y estado.
 * - Scopes útiles (activos).
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const VendedoresModel = db.define(
  'vendedores',
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
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
      unique: 'uq_vendedores_documento',
      validate: {
        len: { args: [0, 20], msg: 'Documento: máximo 20 caracteres.' }
      }
    },
    email: {
      type: DataTypes.STRING(120),
      allowNull: true,
      unique: 'uq_vendedores_email',
      validate: {
        isEmail: { args: true, msg: 'Email inválido.' },
        len: { args: [0, 120], msg: 'Email: máximo 120 caracteres.' }
      }
    },
    telefono: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: {
        len: { args: [0, 50], msg: 'Teléfono: máximo 50 caracteres.' }
      }
    },
    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true
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
    tableName: 'vendedores',
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
      { name: 'uq_vendedores_documento', unique: true, fields: ['documento'] },
      { name: 'uq_vendedores_email', unique: true, fields: ['email'] },
      { name: 'idx_vendedores_nombre', fields: ['nombre'] },
      { name: 'idx_vendedores_estado', fields: ['estado'] }
    ]
  }
);

export default VendedoresModel;
