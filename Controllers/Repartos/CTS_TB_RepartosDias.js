/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 29 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Controladores CRUD para 'repartos_dias'.
 *  - Define qué días de la semana y en qué turno se realiza cada reparto.
 *
 * Tema: Controladores - Repartos
 * Capa: Backend
 */

import { RepartosDiasModel } from '../../Models/Repartos/MD_TB_RepartosDias.js';
import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { Op } from 'sequelize';

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
  'dia_semana',
  'turno',
  'created_at',
  'updated_at'
]);

const sanitizeOrder = (orderBy = 'dia_semana', orderDir = 'ASC') => {
  const col = ORDER_WHITELIST.has(orderBy) ? orderBy : 'dia_semana';
  const dir =
    String(orderDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [col, dir];
};

// ---------- LISTAR (GET /repartos-dias) ----------
export const OBRS_RepartosDias_CTS = async (req, res) => {
  try {
    const {
      reparto_id,
      dia_semana,
      turno,
      page,
      pageSize,
      limit,
      offset,
      orderBy,
      orderDir,
      count = '1',
      withReparto = '1'
    } = req.query;

    const [col, dir] = sanitizeOrder(orderBy, orderDir);

    const where = {};

    const rid = toInt(reparto_id, 0);
    if (rid > 0) where.reparto_id = rid;

    const dia = toInt(dia_semana, 0);
    if (dia >= 1 && dia <= 7) where.dia_semana = dia;

    if (turno) where.turno = turno; // 'maniana' | 'tarde' | 'noche'

    const lim = Math.max(1, toInt(limit ?? pageSize ?? 20, 20));
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
      total = await RepartosDiasModel.count({ where });
    }

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }

    const rows = await RepartosDiasModel.findAll({
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
    console.error('Error al listar repartos_dias:', error);
    return res.status(500).json({
      mensajeError: 'Ocurrió un error al obtener los días de reparto',
      detalles: error?.message || error
    });
  }
};

// ---------- OBTENER UNO (GET /repartos-dias/:id) ----------
export const OBR_RepartoDia_CTS = async (req, res) => {
  try {
    const { withReparto = '1' } = req.query;

    const include = [];
    if (String(withReparto) === '1') {
      include.push({ model: RepartosModel, as: 'reparto' });
    }

    const fila = await RepartosDiasModel.findByPk(req.params.id, {
      include
    });

    if (!fila) {
      return res
        .status(404)
        .json({ mensajeError: 'Día de reparto no encontrado' });
    }

    return res.json(fila);
  } catch (error) {
    console.error('Error al obtener reparto_dia:', error);
    return res.status(500).json({ mensajeError: error?.message || error });
  }
};

// ---------- CREAR (POST /repartos-dias) ----------
export const CR_RepartoDia_CTS = async (req, res) => {
  try {
    const { reparto_id, dia_semana, turno } = req.body;

    const rid = toInt(reparto_id, 0);
    const dia = toInt(dia_semana, 0);

    if (!rid) {
      return res
        .status(400)
        .json({ mensajeError: 'Debe indicar un reparto_id válido.' });
    }
    if (dia < 1 || dia > 7) {
      return res.status(400).json({
        mensajeError: 'El día de semana debe estar entre 1 y 7.'
      });
    }

    const payload = stripEmpty({
      reparto_id: rid,
      dia_semana: dia,
      turno: turno || null
    });

    const creado = await RepartosDiasModel.create(payload);

    return res.json({
      message: 'Día de reparto creado correctamente',
      reparto_dia: creado
    });
  } catch (error) {
    console.error('Error al crear reparto_dia:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo crear el día de reparto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ACTUALIZAR (PUT /repartos-dias/:id) ----------
export const UR_RepartoDia_CTS = async (req, res) => {
  try {
    const { id } = req.params;
    const existente = await RepartosDiasModel.findByPk(id);

    if (!existente) {
      return res
        .status(404)
        .json({ mensajeError: 'Día de reparto no encontrado' });
    }

    const permitidos = ['dia_semana', 'turno'];
    const base = {};
    for (const k of permitidos) {
      if (k in req.body) base[k] = req.body[k];
    }

    const payload = stripEmpty(base);

    if ('dia_semana' in payload) {
      const dia = toInt(payload.dia_semana, 0);
      if (dia < 1 || dia > 7) {
        return res.status(400).json({
          mensajeError: 'El día de semana debe estar entre 1 y 7.'
        });
      }
      payload.dia_semana = dia;
    }

    const [updated] = await RepartosDiasModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res.status(404).json({
        mensajeError: 'Día de reparto no encontrado o sin cambios'
      });
    }

    const actualizado = await RepartosDiasModel.findByPk(id);
    return res.json({
      message: 'Día de reparto actualizado correctamente',
      reparto_dia: actualizado
    });
  } catch (error) {
    console.error('Error al actualizar reparto_dia:', error);
    return res.status(400).json({
      mensajeError: 'No se pudo actualizar el día de reparto',
      detalles: error?.errors || error?.message || error
    });
  }
};

// ---------- ELIMINAR (DELETE /repartos-dias/:id) ----------
export const ER_RepartoDia_CTS = async (req, res) => {
  try {
    const id = toInt(req.params.id, 0);

    if (!id) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido' });
    }

    const existe = await RepartosDiasModel.findByPk(id);
    if (!existe) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Día de reparto no encontrado'
      });
    }

    const deleted = await RepartosDiasModel.destroy({
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
  } catch (error) {
    console.error('Error al eliminar reparto_dia:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: error?.message || String(error)
    });
  }
};

export default {
  OBRS_RepartosDias_CTS,
  OBR_RepartoDia_CTS,
  CR_RepartoDia_CTS,
  UR_RepartoDia_CTS,
  ER_RepartoDia_CTS
};
