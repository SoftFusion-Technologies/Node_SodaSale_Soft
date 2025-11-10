/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 21 / 06 / 2025
 * Versión: 1.1
 *
 * Descripción:
 * Este archivo (MD_TB_Users.js) contiene la definición del modelo Sequelize para la tabla de usuarios.
 * Incluye roles personalizados y relación con locales.
 *
 * Tema: Modelos - Usuarios
 * Capa: Backend
 */

// Importaciones
import dotenv from 'dotenv';
import db from '../DataBase/db.js';
import { DataTypes } from 'sequelize';
import { LocalesModel } from './MD_TB_Locales.js';
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Definición del modelo de la tabla 'usuarios'
export const UserModel = db.define(
  'usuarios',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    rol: {
      type: DataTypes.ENUM('socio', 'administrativo', 'vendedor', 'contador'),
      allowNull: false
    },
    local_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: 'locales',
        key: 'id'
      }
    },
    es_reemplazante: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si el usuario está habilitado como reemplazante'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'usuarios',
    timestamps: false
  }
);

// Relación con locales
UserModel.belongsTo(LocalesModel, { foreignKey: 'local_id' });

export default {
  UserModel
};
