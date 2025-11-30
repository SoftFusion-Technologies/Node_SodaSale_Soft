/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Controladores CRUD para 'repartos_usuarios'.
 *  - Permite listar el equipo asignado a cada reparto (chofer, ayudante, supervisor).
 *  - Filtros por reparto, usuario, rol y activo.
 *
 * Tema: Controladores - Repartos
 * Capa: Backend
 */

import { RepartosUsuariosModel } from '../../Models/Repartos/MD_TB_RepartosUsuarios.js';
import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { UserModel } from '../../Models/MD_TB_Users.js';
import { Op } from 'sequelize';

// ---------- Helpers ----------
const stripEmpty = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};

const toInt = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

const ORDER_WHITELIST = new Set([
  'id',
  'reparto_id',
  'usuario_id',
  'rol',
  'activo',
  'created_at',
  'updated_at'
]);

const sanitizeOrder = (orderBy = 'id', orderDir = 'ASC') => {
  const col = ORDER_WHITELIST.has(orderBy) ? orderBy : 'id';
  const dir =
    String(orderDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [col, dir];
};

// ---------- LISTAR (GET /repartos-usuarios) ----------
export const OBRS_RepartosUsuarios_CTS = async (req, res) => {
  try {
    const {
      reparto_id,
      usuario_id,
      rol,
      activo,
      q,
      page,
      pageSize,
      limit,
      offset,
      orderBy,
      orderDir,
      count = '1',
      withReparto = '1',
      withUsuario = '1'
    } = req.query;

    const [col, dir] = sanitizeOrder(orderBy, orderDir);

    const where = {};

    const rid = toInt(reparto_id, 0);
    if (rid > 0) where.reparto_id = rid;

    const uid = toInt(usuario_id, 0);
    if (uid > 0) where.usuario_id = uid;

    if (rol) where.rol = rol; // 'chofer' | 'ayudante' | 'supervisor'

    if (activo !== undefined) {
      // activo=1,0,true,false
      const val = String(activo).toLowerCase();
      if (['1', 'true', 'si', 'sí'].includes(val)) where.activo = true;
      if (['0', 'false', 'no'].includes(val)) where.activo = false;
    }

    if (q && String(q).trim() !== '') {
      // Búsqueda muy básica: por id, reparto_id, usuario_id
      const qTrim = String(q).trim();
      const n = toInt(qTrim, NaN);
      if (Number.isFinite(n)) {
        where[Op.or] = [{ id: n }, { reparto_id: n }, { usuario_id: n }];
      }
    }

    const lim = Math.max(1, toInt(limit ?? pageSize ?? 50, 50));
    let off = 0;

    if (offset !== undefined) {
      off = Math.max(0, toInt(offset, 0));
    } else if (page !== undefined) {
      const p = Math.max(1, toInt(page, 1));
      const ps = Math.max(1, toInt(pageSize ?? lim, lim));
      off = (p - 1) * ps;
    }

    let total = null;
    if (String(count) !== '0') {
      total = await RepartosUsuariosModel.count({ where });
    }

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }
    if (String(withUsuario) === '1') {
      include.push({ model: UserModel, as: 'usuario' });
    }

    const rows = await RepartosUsuariosModel.findAll({
      where,
      include,
      order: [[col, dir], ...(col === 'id' ? [] : [['id', 'ASC']])],
      limit: lim,
      offset: off
    });

    const usedTotal = total ?? rows.length;
    const hasNext = off + rows.length < usedTotal;
    const ps = Math.max(1, toInt(pageSize ?? lim, lim));
    const p = Math.floor(off / ps) + 1;
    const totalPages = usedTotal > 0 ? Math.ceil(usedTotal / ps) : 1;

    return res.json({
      data: rows,
      meta: {
        total: usedTotal,
        limit: lim,
        offset: off,
        hasNext,
        page: p,
        pageSize: ps,
        totalPages,
        orderBy: col,
        orderDir: dir
      }
    });
  } catch (error) {
    console.error('Error al listar repartos_usuarios:', error);
    return res.status(500).json({
      mensajeError: 'Ocurrió un error al obtener el equipo de repartos',
      detalles: error?.message || error
    });
  }
};

// ---------- OBTENER UNO (GET /repartos-usuarios/:id) ----------
export const OBR_RepartoUsuario_CTS = async (req, res) => {
  try {
    const { withReparto = '1', withUsuario = '1' } = req.query;

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }
    if (String(withUsuario) === '1') {
      include.push({ model: UserModel, as: 'usuario' });
    }

    const fila = await RepartosUsuariosModel.findByPk(req.params.id, {
      include
    });

    if (!fila) {
      return res
        .status(404)
        .json({ mensajeError: 'Relación reparto-usuario no encontrada' });
    }

    return res.json(fila);
  } catch (error) {
    console.error('Error al obtener reparto_usuario:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

// ---------- CREAR (POST /repartos-usuarios) ----------
export const CR_RepartoUsuario_CTS = async (req, res) => {
  try {
    const { reparto_id, usuario_id, rol, activo } = req.body;

    const rid = toInt(reparto_id, 0);
    const uid = toInt(usuario_id, 0);

    if (!rid || !uid) {
      return res.status(400).json({
        mensajeError: 'Se requiere reparto_id y usuario_id válidos'
      });
    }

    const payload = stripEmpty({
      reparto_id: rid,
      usuario_id: uid,
      rol: rol || 'chofer',
      activo:
        activo === undefined
          ? true
          : ['1', 'true', 'si', 'sí'].includes(String(activo).toLowerCase())
    });

    const creado = await RepartosUsuariosModel.create(payload);

    return res.json({
      message: 'Usuario asignado al reparto correctamente',
      reparto_usuario: creado
    });
  } catch (error) {
    console.error('Error al crear reparto_usuario:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo asignar el usuario al reparto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ACTUALIZAR (PUT /repartos-usuarios/:id) ----------
export const UR_RepartoUsuario_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await RepartosUsuariosModel.findByPk(id);

    if (!existente) {
      return res.status(404).json({
        mensajeError: 'Relación reparto-usuario no encontrada'
      });
    }

    const permitidos = ['rol', 'activo'];
    const base = {};
    for (const k of permitidos) {
      if (k in req.body) base[k] = req.body[k];
    }

    const payload = stripEmpty(base);

    if ('activo' in payload) {
      const val = String(payload.activo).toLowerCase();
      payload.activo = ['1', 'true', 'si', 'sí'].includes(val);
    }

    const [updated] = await RepartosUsuariosModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res.status(404).json({
        mensajeError: 'Relación no encontrada o sin cambios'
      });
    }

    const actualizado = await RepartosUsuariosModel.findByPk(id);
    return res.json({
      message: 'Relación reparto-usuario actualizada correctamente',
      reparto_usuario: actualizado
    });
  } catch (error) {
    console.error('Error al actualizar reparto_usuario:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo actualizar la relación',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ELIMINAR (DELETE /repartos-usuarios/:id) ----------
export const ER_RepartoUsuario_CTS = async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);
    const soft = ['1', 'true', 'si', 'sí', 'soft'].includes(
      String(req.query.soft || '').toLowerCase()
    );

    if (!id) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido' });
    }

    const existe = await RepartosUsuariosModel.findByPk(id);
    if (!existe) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Relación reparto-usuario no encontrada'
      });
    }

    if (!soft) {
      const deleted = await RepartosUsuariosModel.destroy({
        where: { id },
        limit: 1
      });
      if (deleted === 0) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          mensajeError: 'No se pudo eliminar (ya no existe)'
        });
      }
      return res.status(204).send();
    }

    const [upd] = await RepartosUsuariosModel.update(
      { activo: false },
      { where: { id }, limit: 1 }
    );

    const inactivado = await RepartosUsuariosModel.findByPk(id);
    return res.json({
      message: 'Relación dada de baja (activo = false)',
      reparto_usuario: inactivado
    });
  } catch (error) {
    console.error('Error al eliminar reparto_usuario:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: error?.message || String(error)
    });
  }
};

// ---------- Cambiar activo (PATCH /repartos-usuarios/:id/activo) ----------
export const UR_RepartoUsuario_Activo_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const val = String(activo).toLowerCase();
    const bool =
      ['1', 'true', 'si', 'sí'].includes(val) ||
      activo === true ||
      activo === 1;

    const [n] = await RepartosUsuariosModel.update(
      { activo: bool },
      { where: { id } }
    );

    if (n !== 1) {
      return res.status(404).json({
        mensajeError: 'Relación reparto-usuario no encontrada'
      });
    }

    const fila = await RepartosUsuariosModel.findByPk(id);
    return res.json({
      message: 'Estado activo actualizado',
      reparto_usuario: fila
    });
  } catch (error) {
    console.error('Error al cambiar activo reparto_usuario:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

export default {
  OBRS_RepartosUsuarios_CTS,
  OBR_RepartoUsuario_CTS,
  CR_RepartoUsuario_CTS,
  UR_RepartoUsuario_CTS,
  ER_RepartoUsuario_CTS,
  UR_RepartoUsuario_Activo_CTS
};
