// ===============================
// FILE: Controllers/Vendedores/CTS_TB_Vendedores.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controlador (ES6) para el módulo Vendedores.
 * - Listado con q/estado + paginación/orden
 * - Detalle por id
 * - Alta, Update
 * - PATCH estado
 * - DELETE con chequeo de dependencias (vendedor_barrios)
 *
 * Códigos de error:
 * - BAD_REQUEST
 * - NOT_FOUND
 * - DUPLICATE
 * - HAS_DEPENDENCIES
 * - SERVER_ERROR
 */

import { Op } from 'sequelize';
import VendedoresModel from '../../Models/Vendedores/MD_TB_Vendedores.js';
import VendedorBarrioModel from '../../Models/Vendedores/MD_TB_VendedorBarrios.js';

// ---------- Helpers ----------
const ALLOWED_ORDER = new Set([
  'id',
  'nombre',
  'estado',
  'created_at',
  'updated_at'
]);

function normInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normOrder(orderBy, orderDir) {
  const field = ALLOWED_ORDER.has(String(orderBy || '').toLowerCase())
    ? orderBy
    : 'created_at';
  const dir =
    String(orderDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  return [field, dir];
}

function buildWhere({ q, estado }) {
  const where = {};
  if (estado && ['activo', 'inactivo'].includes(String(estado))) {
    where.estado = estado;
  }
  if (q) {
    const like = `%${q}%`;
    where[Op.or] = [
      { nombre: { [Op.like]: like } },
      { documento: { [Op.like]: like } },
      { email: { [Op.like]: like } },
      { telefono: { [Op.like]: like } }
    ];
  }
  return where;
}

function metaFrom(total, page, limit) {
  const totalPages =
    total != null ? Math.max(1, Math.ceil(total / limit)) : null;
  return {
    total,
    page,
    limit,
    totalPages,
    hasPrev: page > 1,
    hasNext: totalPages ? page < totalPages : false
  };
}

// ---------- LIST (GET /vendedores) ----------
export const OBRS_Vendedores_CTS = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const estado = (req.query.estado || '').trim(); // 'activo' | 'inactivo'
    const page = Math.max(1, normInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, normInt(req.query.limit, 20)));
    const [orderBy, orderDir] = normOrder(
      req.query.orderBy,
      req.query.orderDir
    );

    const where = buildWhere({ q, estado });

    const { rows, count } = await VendedoresModel.findAndCountAll({
      where,
      order: [[orderBy, orderDir]],
      limit,
      offset: (page - 1) * limit
    });

    return res.json({
      data: rows,
      meta: metaFrom(count, page, limit)
    });
  } catch (error) {
    console.error('OBRS_Vendedores_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo obtener el listado de vendedores.'
    });
  }
};

// ---------- GET ONE (GET /vendedores/:id) ----------
export const OBR_Vendedor_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id, NaN);
    if (!Number.isFinite(id)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const includeAsignaciones =
      String(req.query.include_asignaciones || '') === '1';

    const vendedor = await VendedoresModel.findByPk(id, {
      include: includeAsignaciones
        ? [
            {
              model: VendedorBarrioModel,
              as: 'asignaciones',
              required: false,
              attributes: [
                'id',
                'barrio_id',
                'asignado_desde',
                'asignado_hasta',
                'estado',
                'vigente_flag'
              ],
              order: [
                ['asignado_desde', 'DESC'],
                ['id', 'DESC']
              ]
            }
          ]
        : undefined
    });

    if (!vendedor) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }
    return res.json(vendedor);
  } catch (error) {
    console.error('OBR_Vendedor_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo obtener el vendedor.'
    });
  }
};

// ---------- CREATE (POST /vendedores) ----------
export const CR_Vendedor_CTS = async (req, res) => {
  try {
    const {
      nombre,
      documento,
      email,
      telefono,
      estado = 'activo',
      notas
    } = req.body || {};

    if (!nombre || String(nombre).trim() === '') {
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'El nombre es obligatorio.'
        });
    }
    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Estado inválido.' });
    }

    // (Opcional) validaciones simples previas a DB
    // if (documento && !/^\d{7,11}$/.test(documento)) { ... }

    const nuevo = await VendedoresModel.create({
      nombre: String(nombre).trim(),
      documento: documento || null,
      email: email || null,
      telefono: telefono || null,
      estado,
      notas: notas || null
    });

    return res.status(201).json(nuevo);
  } catch (error) {
    console.error('CR_Vendedor_CTS error:', error);

    // Unique violations
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const fields = Object.keys(error?.fields || {});
      let field = fields[0] || 'documento/email';
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: `Ya existe un vendedor con ese ${field}.`,
        details: { fields }
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear el vendedor.'
    });
  }
};

// ---------- UPDATE (PUT /vendedores/:id) ----------
export const UR_Vendedor_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id, NaN);
    if (!Number.isFinite(id)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const vendedor = await VendedoresModel.findByPk(id);
    if (!vendedor) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }

    const { nombre, documento, email, telefono, estado, notas } =
      req.body || {};

    if (estado && !['activo', 'inactivo'].includes(String(estado))) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Estado inválido.' });
    }

    await vendedor.update({
      ...(nombre !== undefined ? { nombre: String(nombre).trim() } : {}),
      ...(documento !== undefined ? { documento: documento || null } : {}),
      ...(email !== undefined ? { email: email || null } : {}),
      ...(telefono !== undefined ? { telefono: telefono || null } : {}),
      ...(estado !== undefined ? { estado } : {}),
      ...(notas !== undefined ? { notas: notas || null } : {})
    });

    return res.json(vendedor);
  } catch (error) {
    console.error('UR_Vendedor_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      const fields = Object.keys(error?.fields || {});
      let field = fields[0] || 'documento/email';
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError: `Ya existe un vendedor con ese ${field}.`,
        details: { fields }
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el vendedor.'
    });
  }
};

// ---------- PATCH ESTADO (PATCH /vendedores/:id/estado) ----------
export const UR_Vendedor_Estado_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id, NaN);
    if (!Number.isFinite(id)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const { estado } = req.body || {};
    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Estado inválido.' });
    }

    const vendedor = await VendedoresModel.findByPk(id);
    if (!vendedor) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }

    await vendedor.update({ estado });
    return res.json({ message: 'Estado actualizado', vendedor });
  } catch (error) {
    console.error('UR_Vendedor_Estado_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo actualizar el estado.'
    });
  }
};

// ---------- DELETE (DELETE /vendedores/:id?hard=1) ----------
export const ER_Vendedor_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id, NaN);
    if (!Number.isFinite(id)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'ID inválido.' });
    }

    const hard = ['1', 'true', 'si', 'sí'].includes(
      String(req.query.hard || '').toLowerCase()
    );

    const vendedor = await VendedoresModel.findByPk(id);
    if (!vendedor) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }

    // Chequear dependencias (asignaciones a barrios)
    const [vigentes, total] = await Promise.all([
      VendedorBarrioModel.count({
        where: { vendedor_id: id, asignado_hasta: { [Op.is]: null } }
      }),
      VendedorBarrioModel.count({ where: { vendedor_id: id } })
    ]);

    if (total > 0) {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError:
          'No se puede eliminar: el vendedor tiene asignaciones de barrios (históricas o vigentes).',
        details: { asignacionesVigentes: vigentes, asignacionesTotal: total },
        tips: [
          'Cerrá las asignaciones vigentes (asignado_hasta) o eliminá el histórico si corresponde.',
          'Como alternativa, desactivá el vendedor (PATCH /vendedores/:id/estado).'
        ]
      });
    }

    if (hard) {
      const deleted = await VendedoresModel.destroy({
        where: { id },
        limit: 1
      });
      if (deleted === 0) {
        return res
          .status(404)
          .json({
            code: 'NOT_FOUND',
            mensajeError: 'No se pudo eliminar (ya no existe).'
          });
      }
      return res.status(204).send(); // estándar para hard delete sin body
    }

    // Baja lógica → estado = inactivo
    await vendedor.update({ estado: 'inactivo' });
    return res.json({
      message: 'Vendedor dado de baja (estado=inactivo)',
      vendedor
    });
  } catch (error) {
    console.error('ER_Vendedor_CTS error:', error);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar el vendedor.'
    });
  }
};

export default {
  OBRS_Vendedores_CTS,
  OBR_Vendedor_CTS,
  CR_Vendedor_CTS,
  UR_Vendedor_CTS,
  UR_Vendedor_Estado_CTS,
  ER_Vendedor_CTS
};
