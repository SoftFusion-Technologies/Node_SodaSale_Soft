/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 21 / 06 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Este archivo (CTS_TB_Users.js) contiene controladores para manejar operaciones CRUD sobre la tabla de usuarios.
 *
 * Tema: Controladores - Usuarios
 * Capa: Backend
 */

// Importar el modelo
import MD_TB_Users from '../Models/MD_TB_Users.js';
import { LocalesModel } from '../Models/MD_TB_Locales.js';
import bcrypt from 'bcryptjs';

const UserModel = MD_TB_Users.UserModel;

// Util: normalizar booleano desde varios formatos
const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string')
    return ['1', 'true', 'si', 'sí', 'yes'].includes(v.toLowerCase());
  return false;
};

// Util: elimina claves con '', null o undefined
const stripEmpty = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};

// Obtener todos los usuarios
export const OBRS_Usuarios_CTS = async (req, res) => {
  try {
    const usuarios = await UserModel.findAll({
      include: [{ model: LocalesModel }]
    });
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Obtener un solo usuario por ID
export const OBR_Usuario_CTS = async (req, res) => {
  try {
    const usuario = await UserModel.findByPk(req.params.id, {
      include: [{ model: LocalesModel }]
    });
    if (!usuario)
      return res.status(404).json({ mensajeError: 'Usuario no encontrado' });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Crear un nuevo usuario
export const CR_Usuario_CTS = async (req, res) => {
  const { nombre, email, password, rol, local_id, usuario_log_id } = req.body;

  const es_reemplazante = toBool(req.body.es_reemplazante);

  if (!email || !password || !nombre) {
    return res.status(400).json({
      mensajeError: 'Faltan campos obligatorios: nombre, email y password'
    });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const nuevo = await UserModel.create({
      nombre,
      email,
      password: hashedPassword,
      rol,
      local_id,
      es_reemplazante
    });

    res.json({ message: 'Usuario creado correctamente', usuario: nuevo });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({
      mensajeError: error.message,
      detalles: error.errors || error
    });
  }
};

// Eliminar un usuario
export const ER_Usuario_CTS = async (req, res) => {
  const { usuario_log_id } = req.body;

  try {
    const usuario = await UserModel.findByPk(req.params.id);
    if (!usuario)
      return res.status(404).json({ mensajeError: 'Usuario no encontrado' });

    await UserModel.destroy({ where: { id: req.params.id } });

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};

// Actualizar un usuario
export const UR_Usuario_CTS = async (req, res) => {
  const { id } = req.params;
  const { usuario_log_id } = req.body;

  try {
    const usuarioAnterior = await UserModel.findByPk(id);
    if (!usuarioAnterior) {
      return res.status(404).json({ mensajeError: 'Usuario no encontrado' });
    }

    // Tomamos solo campos permitidos
    const permitidos = [
      'nombre',
      'email',
      'rol',
      'local_id',
      'es_reemplazante',
      'password'
    ];
    const basePayload = {};
    for (const key of permitidos) {
      if (key in req.body) basePayload[key] = req.body[key];
    }

    // Limpiar strings vacíos para evitar setear "" en DB
    let payload = stripEmpty(basePayload);

    // Normalizar tipos
    if ('local_id' in payload) {
      payload.local_id =
        payload.local_id === '' ? null : Number(payload.local_id);
    }
    if ('es_reemplazante' in payload) {
      payload.es_reemplazante = toBool(payload.es_reemplazante);
    }

    // Hashear password solo si viene no vacía (tras stripEmpty)
    if ('password' in payload) {
      const salt = await bcrypt.genSalt(10);
      payload.password = await bcrypt.hash(payload.password, salt);
    }

    // Armar difs para logs (sin mostrar password)
    const camposParaDiff = [
      'nombre',
      'email',
      'rol',
      'local_id',
      'es_reemplazante'
    ];
    const cambios = [];
    for (const key of camposParaDiff) {
      if (key in payload) {
        const nuevoVal =
          key === 'es_reemplazante'
            ? payload[key]
              ? 'sí'
              : 'no'
            : String(payload[key]);
        const anteriorVal =
          key === 'es_reemplazante'
            ? usuarioAnterior[key]
              ? 'sí'
              : 'no'
            : String(usuarioAnterior[key] ?? '');
        if (nuevoVal !== anteriorVal) {
          cambios.push(`cambió "${key}" de "${anteriorVal}" a "${nuevoVal}"`);
        }
      }
    }
    if ('password' in payload) {
      cambios.push('actualizó "password"');
    }

    // Update seguro: solo los campos que quedaron en payload
    const [updated] = await UserModel.update(payload, {
      where: { id },
      // fields limita explícitamente qué columnas tocar
      fields: Object.keys(payload)
    });

    if (updated === 1) {
      const actualizado = await UserModel.findByPk(id);

      res.json({ message: 'Usuario actualizado correctamente', actualizado });
    } else {
      res.status(404).json({ mensajeError: 'Usuario no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ mensajeError: error.message });
  }
};
