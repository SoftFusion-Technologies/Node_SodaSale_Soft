/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Modelo Sequelize para la tabla 'reparto_clientes'.
 *  Representa la asignación de clientes a un reparto, con un número de rango
 *  único dentro de cada reparto.
 *
 * Tema: Modelos - Repartos
 * Capa: Backend
 */

import dotenv from 'dotenv';
import db from '../../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const RepartoClientesModel = db.define(
  'reparto_clientes',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    reparto_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        notNull: { msg: 'El reparto es requerido' },
        isInt: { msg: 'El campo reparto_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'El reparto debe ser un ID válido'
        }
      }
    },
    cliente_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      validate: {
        notNull: { msg: 'El cliente es requerido' },
        isInt: { msg: 'El campo cliente_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'El cliente debe ser un ID válido'
        }
      }
    },
    numero_rango: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment:
        'Número de orden dentro del reparto (debe estar dentro del rango del reparto)',
      validate: {
        notNull: { msg: 'El número de rango es requerido' },
        isInt: { msg: 'El número de rango debe ser numérico' }
        // min: { args: [1], msg: 'El número de rango debe ser mayor o igual a 1' }
      }
    },
    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    }
  },
  {
    tableName: 'reparto_clientes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        name: 'uq_repcli_reparto_cliente',
        unique: true,
        fields: ['reparto_id', 'cliente_id']
      },
      {
        name: 'uq_repcli_reparto_numero',
        unique: true,
        fields: ['reparto_id', 'numero_rango']
      },
      {
        name: 'idx_repcli_cliente',
        fields: ['cliente_id']
      },
      {
        name: 'idx_repcli_reparto',
        fields: ['reparto_id', 'numero_rango']
      }
    ],
    defaultScope: {
      // nada por defecto, pero se podría filtrar solo activos:
      // where: { estado: 'activo' }
    },
    scopes: {
      activos: { where: { estado: 'activo' } },
      inactivos: { where: { estado: 'inactivo' } }
    }
  }
);

export default { RepartoClientesModel };
