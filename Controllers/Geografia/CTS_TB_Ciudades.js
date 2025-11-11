/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 10 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controladores CRUD para 'ciudades'.
 * - Listado con paginación y filtros (q, estado, provincia).
 * - Alta/Edición validando UNIQUE (nombre, provincia).
 * - Patch de estado (activa/inactiva).
 * - Borrado: si hay localidades asociadas, bloquea y sugiere desactivar.
 */

import { Op } from 'sequelize';
import { CiudadesModel } from '../../Models/Geografia/MD_TB_Ciudades.js';
import { LocalidadesModel } from '../../Models/Geografia/MD_TB_Localidades.js';

/* =======================
   Helpers
   ======================= */
const toInt = (v, d = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const stripEmpty = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
};
const allowedOrder = new Set([
  'nombre',
  'provincia',
  'estado',
  'created_at',
  'updated_at'
]);
const safeOrderBy = (v) => (allowedOrder.has(v) ? v : 'nombre');
const safeOrderDir = (v) =>
  String(v || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

/* =========================================================
   GET /geo/ciudades  → listado con paginación y filtros
   Query: q, estado, provincia, page, limit, orderBy, orderDir
   ========================================================= */
export const OBRS_Ciudades_CTS = async (req, res) => {
  try {
    const {
      q = '',
      estado,
      provincia,
      page = 1,
      limit = 18,
      orderBy = 'nombre',
      orderDir = 'ASC'
    } = req.query;

    const where = {};
    if (q && q.trim()) {
      where[Op.or] = [
        { nombre: { [Op.like]: `%${q.trim()}%` } },
        { provincia: { [Op.like]: `%${q.trim()}%` } }
      ];
    }
    if (estado && ['activa', 'inactiva'].includes(estado)) {
      where.estado = estado;
    }
    if (provincia && provincia.trim()) {
      where.provincia = provincia.trim();
    }

    const _page = Math.max(1, toInt(page, 1));
    const _limit = Math.min(100, Math.max(1, toInt(limit, 18)));
    const offset = (_page - 1) * _limit;

    const { rows, count } = await CiudadesModel.findAndCountAll({
      where,
      offset,
      limit: _limit,
      order: [[safeOrderBy(orderBy), safeOrderDir(orderDir)]]
    });

    const totalPages = Math.max(1, Math.ceil(count / _limit));
    const meta = {
      total: count,
      page: _page,
      limit: _limit,
      totalPages,
      hasPrev: _page > 1,
      hasNext: _page < totalPages
    };

    return res.json({ data: rows, meta });
  } catch (error) {
    console.error('OBRS_Ciudades_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron cargar las ciudades'
    });
  }
};

/* ==========================================
   GET /geo/ciudades/:id  → obtener una
   ========================================== */
export const OBR_Ciudad_CTS = async (req, res) => {
  try {
    const ciudad = await CiudadesModel.findByPk(req.params.id);
    if (!ciudad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Ciudad no encontrada'
      });
    }
    return res.json(ciudad);
  } catch (error) {
    console.error('OBR_Ciudad_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error al obtener la ciudad'
    });
  }
};

/* ==========================================
   POST /geo/ciudades  → crear
   Body: { nombre, provincia?, estado? }
   ========================================== */
export const CR_Ciudad_CTS = async (req, res) => {
  try {
    const payload = stripEmpty({
      nombre: req.body?.nombre,
      provincia: req.body?.provincia ?? 'Tucumán',
      estado: req.body?.estado ?? 'activa'
    });

    if (!payload.nombre) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'El nombre es obligatorio'
      });
    }

    const nueva = await CiudadesModel.create(payload);
    return res.status(201).json({
      message: 'Ciudad creada correctamente',
      ciudad: nueva
    });
  } catch (error) {
    console.error('CR_Ciudad_CTS error:', error);

    // Unique (nombre, provincia)
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Ya existe una ciudad con ese nombre en esa provincia',
        tips: [
          'Verificá que no esté cargada',
          'Cambiale el nombre o la provincia'
        ]
      });
    }

    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear la ciudad'
    });
  }
};

/* ==========================================
   PUT /geo/ciudades/:id  → actualizar
   Body permitido: { nombre?, provincia?, estado? }
   ========================================== */
export const UR_Ciudad_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const ciudad = await CiudadesModel.findByPk(id);
    if (!ciudad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Ciudad no encontrada'
      });
    }

    const permitidos = ['nombre', 'provincia', 'estado'];
    const base = {};
    for (const k of permitidos) if (k in req.body) base[k] = req.body[k];
    const payload = stripEmpty(base);

    // Update solo de lo que vino
    const [updated] = await CiudadesModel.update(payload, {
      where: { id },
      fields: Object.keys(payload)
    });

    if (updated !== 1) {
      return res.status(500).json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo actualizar la ciudad'
      });
    }

    const actualizada = await CiudadesModel.findByPk(id);
    return res.json({
      message: 'Ciudad actualizada correctamente',
      ciudad: actualizada
    });
  } catch (error) {
    console.error('UR_Ciudad_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: 'Ya existe una ciudad con ese nombre en esa provincia'
      });
    }
    if (error?.name === 'SequelizeValidationError') {
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: error?.errors?.[0]?.message || 'Datos inválidos'
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'Error al actualizar la ciudad'
    });
  }
};

/* ==========================================
   PATCH /geo/ciudades/:id/estado  → cambiar estado
   Body: { estado: 'activa' | 'inactiva' }
   ========================================== */
export const PR_Ciudad_Estado_CTS = async (req, res) => {
  try {
    const id = req.params.id;
    const { estado } = req.body || {};
    if (!['activa', 'inactiva'].includes(estado)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: "Estado inválido. Use 'activa' o 'inactiva'."
      });
    }
    const [updated] = await CiudadesModel.update(
      { estado },
      { where: { id }, fields: ['estado'] }
    );
    if (updated !== 1) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Ciudad no encontrada'
      });
    }
    const ciudad = await CiudadesModel.findByPk(id);
    return res.json({
      message: 'Estado actualizado',
      ciudad
    });
  } catch (error) {
    console.error('PR_Ciudad_Estado_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el estado'
    });
  }
};

/* ==========================================
   DELETE /geo/ciudades/:id  → eliminar
   ========================================== 
*/
export const ER_Ciudad_CTS = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID inválido'
      });
    }

    const ciudad = await CiudadesModel.findByPk(id);
    if (!ciudad) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Ciudad no encontrada'
      });
    }

    // Dependencias: localidades
    const deps = await LocalidadesModel.count({ where: { ciudad_id: id } });
    if (deps > 0) {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError:
          'No se puede eliminar: la ciudad tiene localidades asociadas.',
        details: { localidadesAsociadas: deps },
        tips: [
          'Reasigná o eliminá las localidades',
          'Como alternativa, desactivá la ciudad (PATCH /estado)'
        ]
      });
    }

    const deleted = await CiudadesModel.destroy({ where: { id }, limit: 1 });
    if (deleted === 0) {
      // Si no borró ninguna fila, devolvemos 404 para que el front sepa
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'No se pudo eliminar (no existe o ya fue eliminada)'
      });
    }

    // 204: sin body, estándar para delete exitoso
    return res.status(204).send();
  } catch (error) {
    console.error('ER_Ciudad_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar la ciudad'
    });
  }
};
