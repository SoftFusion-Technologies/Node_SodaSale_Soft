/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 21 / 06 / 2025
 * Versión: 1.1
 *
 * Descripción:
 * Este archivo (MD_TB_Locales.js) contiene la definición del modelo Sequelize para la tabla de sucursales (locales),
 * incluyendo todos los campos operativos y administrativos actualizados para "El Sueño".
 *
 * Tema: Modelos - Locales
 * Capa: Backend
 */

// Importaciones
import dotenv from 'dotenv';
import db from '../DataBase/db.js';
import { DataTypes } from 'sequelize';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Definición del modelo de la tabla 'locales'
export const LocalesModel = db.define(
  'locales',
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
    codigo: {
      type: DataTypes.STRING(10),
      unique: true,
      allowNull: true
    },
    direccion: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    ciudad: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    provincia: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: 'Tucumán'
    },
    telefono: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    responsable_nombre: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    responsable_dni: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    horario_apertura: {
      type: DataTypes.TIME,
      allowNull: true,
      defaultValue: '09:00:00'
    },
    horario_cierre: {
      type: DataTypes.TIME,
      allowNull: true,
      defaultValue: '18:00:00'
    },
    printer_nombre: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    estado: {
      type: DataTypes.ENUM('activo', 'inactivo'),
      allowNull: false,
      defaultValue: 'activo'
    },
    creado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    actualizado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'locales',
    timestamps: false
  }
);

// Exportación
export default {
  LocalesModel
};
