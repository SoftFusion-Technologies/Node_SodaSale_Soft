// ===============================
// FILE: Controllers/Vendedores/CTS_TB_VendedorBarrios.js
// ===============================
/*
 * Programador: Benjamin Orellana
 * Fecha: 11 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 * Controlador para histórico de asignaciones Vendedor ↔ Barrio.
 * - GET /vendedor_barrios (global, filtros)
 * - GET /vendedores/:id/barrios (por vendedor, filtros)
 * - POST /vendedores/:id/barrios (alta, con auto-cierre opcional)
 * - PATCH /vendedores/:id/barrios/:asigId/cerrar (cierra asignación)
 * - PATCH /vendedores/:id/barrios/:asigId/estado (activa/inactiva)
 * - DELETE /vendedores/:id/barrios/:asigId (borra; bloquea si vigente salvo hard=1)
 *
 * Flags/convenciones:
 * - autoClose=1 (query/body): al crear, cierra la vigente del barrio (si existe) antes de crear la nueva
 * - vigente = asignado_hasta IS NULL
 * - Únicos de BD protegen: un solo vigente por barrio y por par vendedor-barrio
 */

import { Op, Sequelize } from 'sequelize';
import db from '../../DataBase/db.js';

import VendedoresModel from '../../Models/Vendedores/MD_TB_Vendedores.js';
import VendedorBarrioModel from '../../Models/Vendedores/MD_TB_VendedorBarrios.js';

import BarriosModel from '../../Models/Geografia/MD_TB_Barrios.js';
import LocalidadesModel from '../../Models/Geografia/MD_TB_Localidades.js';
import CiudadesModel from '../../Models/Geografia/MD_TB_Ciudades.js';

// ---------- includes de geografía (para joins lindos)
const incGeo = [
  {
    model: BarriosModel,
    as: 'barrio',
    attributes: ['id', 'nombre', 'estado', 'localidad_id'],
    include: [
      {
        model: LocalidadesModel,
        as: 'localidad',
        attributes: ['id', 'nombre', 'ciudad_id'],
        include: [
          {
            model: CiudadesModel,
            as: 'ciudad',
            attributes: ['id', 'nombre', 'provincia']
          }
        ]
      }
    ]
  }
];

// ---------- helpers ----------
const normInt = (v, d = NaN) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const parseDateTime = (v, fallback = null) => {
  if (!v) return fallback;
  const d = new Date(v);
  return isNaN(d.getTime()) ? fallback : d;
};

const metaFrom = (total, page, limit) => {
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
};

// =====================================================
// LISTADO GLOBAL (GET /vendedor_barrios)
// Filtros: vendedor_id, barrio_id, vigente=1, estado, desde/hasta (rango en asignado_desde)
// Orden/paginación: orderBy=id/asignado_desde/… | orderDir=ASC/DESC | page/limit
// includeGeo=1 para joins de barrio→localidad→ciudad
// =====================================================
export const OBRS_VB_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.query.vendedor_id);
    const barrio_id = normInt(req.query.barrio_id);
    const vigente = String(req.query.vigente || '') === '1';
    const estado = (req.query.estado || '').trim(); // 'activo'|'inactivo'
    const desde = parseDateTime(req.query.desde);
    const hasta = parseDateTime(req.query.hasta);

    const page = Math.max(1, normInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, normInt(req.query.limit, 20)));
    const orderBy = [
      'id',
      'asignado_desde',
      'asignado_hasta',
      'created_at'
    ].includes(req.query.orderBy)
      ? req.query.orderBy
      : 'asignado_desde';
    const orderDir =
      String(req.query.orderDir || 'DESC').toUpperCase() === 'ASC'
        ? 'ASC'
        : 'DESC';

    const where = {};
    if (Number.isFinite(vendedor_id)) where.vendedor_id = vendedor_id;
    if (Number.isFinite(barrio_id)) where.barrio_id = barrio_id;
    if (vigente) where.asignado_hasta = { [Op.is]: null };
    if (estado && ['activo', 'inactivo'].includes(estado))
      where.estado = estado;
    if (desde || hasta) {
      where.asignado_desde = {};
      if (desde) where.asignado_desde[Op.gte] = desde;
      if (hasta) where.asignado_desde[Op.lte] = hasta;
    }

    const include =
      String(req.query.includeGeo || '') === '1' ? incGeo : undefined;

    const { rows, count } = await VendedorBarrioModel.findAndCountAll({
      where,
      include,
      order: [
        [orderBy, orderDir],
        ['id', 'DESC']
      ],
      limit,
      offset: (page - 1) * limit
    });

    return res.json({ data: rows, meta: metaFrom(count, page, limit) });
  } catch (error) {
    console.error('OBRS_VB_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo obtener el listado de asignaciones.'
      });
  }
};

// =====================================================
// LISTADO POR VENDEDOR (GET /vendedores/:id/barrios)
// Query: vigente=1|0, estado, includeGeo=1, page/limit/order
// =====================================================
export const OBRS_VB_PorVendedor_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    if (!Number.isFinite(vendedor_id)) {
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'ID de vendedor inválido.'
        });
    }

    const vigente = String(req.query.vigente || '') === '1';
    const estado = (req.query.estado || '').trim();

    const page = Math.max(1, normInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, normInt(req.query.limit, 20)));
    const orderBy = [
      'id',
      'asignado_desde',
      'asignado_hasta',
      'created_at'
    ].includes(req.query.orderBy)
      ? req.query.orderBy
      : 'asignado_desde';
    const orderDir =
      String(req.query.orderDir || 'DESC').toUpperCase() === 'ASC'
        ? 'ASC'
        : 'DESC';

    const include =
      String(req.query.includeGeo || '') === '1' ? incGeo : undefined;

    const where = { vendedor_id };
    if (vigente) where.asignado_hasta = { [Op.is]: null };
    if (estado && ['activo', 'inactivo'].includes(estado))
      where.estado = estado;

    const { rows, count } = await VendedorBarrioModel.findAndCountAll({
      where,
      include,
      order: [
        [orderBy, orderDir],
        ['id', 'DESC']
      ],
      limit,
      offset: (page - 1) * limit
    });

    return res.json({ data: rows, meta: metaFrom(count, page, limit) });
  } catch (error) {
    console.error('OBRS_VB_PorVendedor_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo obtener las asignaciones del vendedor.'
      });
  }
};

// =====================================================
// CREATE (POST /vendedores/:id/barrios)
// body: { barrio_id, asignado_desde?, asignado_hasta?, estado?, autoClose? }
// - Valida vendedor/barrio existentes
// - Si autoClose=1: cierra vigente del barrio (si la hay) antes de crear
// - Si hay colisión de únicos → DUPLICATE/HAS_VIGENTE
// =====================================================
export const CR_VB_Asigna_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    if (!Number.isFinite(vendedor_id)) {
      await t.rollback();
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'ID de vendedor inválido.'
        });
    }

    const { barrio_id, asignado_desde, asignado_hasta, estado, autoClose } =
      req.body || {};
    const bId = normInt(barrio_id, NaN);
    if (!Number.isFinite(bId)) {
      await t.rollback();
      return res
        .status(400)
        .json({
          code: 'BAD_REQUEST',
          mensajeError: 'barrio_id es obligatorio y debe ser numérico.'
        });
    }

    const [vend, barr] = await Promise.all([
      VendedoresModel.findByPk(vendedor_id, { transaction: t }),
      BarriosModel.findByPk(bId, { transaction: t })
    ]);
    if (!vend) {
      await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Vendedor no encontrado.' });
    }
    if (!barr) {
      await t.rollback();
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Barrio no encontrado.' });
    }

    // Si piden autoClose → cerramos la vigente de ese barrio (con cualquier vendedor)
    const doAutoClose = String(autoClose || req.query.autoClose || '') === '1';
    if (doAutoClose) {
      const vigenteBarrio = await VendedorBarrioModel.findOne({
        where: { barrio_id: bId, asignado_hasta: { [Op.is]: null } },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (vigenteBarrio) {
        const fin = parseDateTime(asignado_desde) || new Date();
        // cerramos la anterior justo antes del inicio nuevo (1 segundo menos)
        const finPrev = new Date(fin.getTime() - 1000);
        await vigenteBarrio.update(
          { asignado_hasta: finPrev },
          { transaction: t }
        );
      }
    } else {
      // Si NO autoClose y hay vigente en ese barrio → bloquear
      const yaHayVigente = await VendedorBarrioModel.count({
        where: { barrio_id: bId, asignado_hasta: { [Op.is]: null } },
        transaction: t
      });
      if (yaHayVigente > 0) {
        await t.rollback();
        return res.status(409).json({
          code: 'HAS_VIGENTE',
          mensajeError:
            'El barrio ya tiene una asignación vigente. Usá autoClose=1 para cerrar la vigente y reasignar.',
          tips: [
            'Reintentá con autoClose=1',
            'O cerrá manualmente la vigente y volvé a crear'
          ]
        });
      }
    }

    const nuevo = await VendedorBarrioModel.create(
      {
        vendedor_id,
        barrio_id: bId,
        asignado_desde: parseDateTime(asignado_desde) || new Date(),
        asignado_hasta: parseDateTime(asignado_hasta) || null,
        estado: ['activo', 'inactivo'].includes(String(estado))
          ? estado
          : 'activo'
      },
      { transaction: t }
    );

    await t.commit();

    // devuelve con geo incluída para que el front pinte lindo
    const withGeo = await VendedorBarrioModel.findByPk(nuevo.id, {
      include: incGeo
    });
    return res.status(201).json(withGeo);
  } catch (error) {
    await t.rollback();
    console.error('CR_VB_Asigna_CTS error:', error);

    if (error?.name === 'SequelizeUniqueConstraintError') {
      // Puede ser por uq_barrio_un_vigente o uq_vendor_barrio_vigente
      return res.status(409).json({
        code: 'DUPLICATE',
        mensajeError:
          'Restricción de unicidad: ya existe una asignación vigente para ese barrio o para ese par vendedor-barrio.',
        tips: ['Usá autoClose=1', 'Verificá si ya existe una fila vigente']
      });
    }

    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo crear la asignación.'
      });
  }
};

// =====================================================
// CERRAR ASIGNACIÓN (PATCH /vendedores/:id/barrios/:asigId/cerrar)
// body: { hasta }  (si no viene, usa now)
// Reglas: hasta >= asignado_desde
// =====================================================
export const UR_VB_Cerrar_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    const hasta = parseDateTime(req.body?.hasta) || new Date();
    if (asig.asignado_desde && hasta < asig.asignado_desde) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'La fecha de cierre no puede ser anterior al inicio.'
      });
    }

    await asig.update({ asignado_hasta: hasta });
    return res.json({ message: 'Asignación cerrada', asignacion: asig });
  } catch (error) {
    console.error('UR_VB_Cerrar_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo cerrar la asignación.'
      });
  }
};

// =====================================================
// PATCH ESTADO (PATCH /vendedores/:id/barrios/:asigId/estado)
// body: { estado: 'activo'|'inactivo' }
// =====================================================
export const UR_VB_Estado_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const { estado } = req.body || {};
    if (!['activo', 'inactivo'].includes(String(estado))) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Estado inválido.' });
    }

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    await asig.update({ estado });
    return res.json({ message: 'Estado actualizado', asignacion: asig });
  } catch (error) {
    console.error('UR_VB_Estado_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo actualizar el estado.'
      });
  }
};

// =====================================================
// DELETE (DELETE /vendedores/:id/barrios/:asigId?hard=1)
// - Si está vigente: bloquea salvo hard=1 (o recomendá cerrar primero)
// =====================================================
export const ER_VB_CTS = async (req, res) => {
  try {
    const vendedor_id = normInt(req.params.id, NaN);
    const asigId = normInt(req.params.asigId, NaN);
    if (!Number.isFinite(vendedor_id) || !Number.isFinite(asigId)) {
      return res
        .status(400)
        .json({ code: 'BAD_REQUEST', mensajeError: 'Parámetros inválidos.' });
    }

    const hard = ['1', 'true', 'si', 'sí'].includes(
      String(req.query.hard || '').toLowerCase()
    );

    const asig = await VendedorBarrioModel.findOne({
      where: { id: asigId, vendedor_id }
    });
    if (!asig) {
      return res
        .status(404)
        .json({ code: 'NOT_FOUND', mensajeError: 'Asignación no encontrada.' });
    }

    const esVigente = asig.asignado_hasta === null;
    if (esVigente && !hard) {
      return res.status(409).json({
        code: 'HAS_DEPENDENCIES',
        mensajeError:
          'No se puede eliminar una asignación vigente. Cerrala primero o usá hard=1.',
        tips: ['PATCH /cerrar con fecha de cierre', 'O reintentá con ?hard=1']
      });
    }

    const deleted = await VendedorBarrioModel.destroy({
      where: { id: asigId, vendedor_id },
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
    return res.status(204).send();
  } catch (error) {
    console.error('ER_VB_CTS error:', error);
    return res
      .status(500)
      .json({
        code: 'SERVER_ERROR',
        mensajeError: 'No se pudo eliminar la asignación.'
      });
  }
};

export default {
  OBRS_VB_CTS,
  OBRS_VB_PorVendedor_CTS,
  CR_VB_Asigna_CTS,
  UR_VB_Cerrar_CTS,
  UR_VB_Estado_CTS,
  ER_VB_CTS
};
