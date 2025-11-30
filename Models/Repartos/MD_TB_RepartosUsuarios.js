/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Modelo Sequelize para la tabla 'repartos_usuarios'.
 *  Relaciona repartos con usuarios (chofer, ayudante, supervisor) y permite
 *  gestionar el equipo asignado a cada recorrido.
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

export const RepartosUsuariosModel = db.define(
  'repartos_usuarios',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    reparto_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'FK → repartos.id',
      validate: {
        notNull: { msg: 'El reparto es requerido' },
        isInt: { msg: 'El campo reparto_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'El reparto debe ser un ID válido'
        }
      }
    },
    usuario_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'FK → usuarios.id (chofer / ayudante / supervisor)',
      validate: {
        notNull: { msg: 'El usuario es requerido' },
        isInt: { msg: 'El campo usuario_id debe ser numérico' },
        min: {
          args: [1],
          msg: 'El usuario debe ser un ID válido'
        }
      }
    },
    rol: {
      type: DataTypes.ENUM('chofer', 'ayudante', 'supervisor'),
      allowNull: false,
      defaultValue: 'chofer',
      comment: 'Rol del usuario dentro del reparto'
    },
    activo: {
      // En MySQL es TINYINT(1), Sequelize lo mapea perfecto con BOOLEAN
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Indica si la asignación sigue activa'
    }
  },
  {
    tableName: 'repartos_usuarios',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    underscored: true,
    indexes: [
      {
        name: 'uq_repusr_reparto_usuario',
        unique: true,
        fields: ['reparto_id', 'usuario_id']
      },
      {
        name: 'idx_repusr_reparto',
        fields: ['reparto_id']
      },
      {
        name: 'idx_repusr_usuario',
        fields: ['usuario_id']
      }
    ],
    defaultScope: {
      // where: { activo: true }
    },
    scopes: {
      activos: { where: { activo: true } },
      inactivos: { where: { activo: false } },
      choferes: { where: { rol: 'chofer' } }
    }
  }
);

export default { RepartosUsuariosModel };
