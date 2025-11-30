/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 30 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Controladores HTTP para el módulo de Cobranzas a Clientes.
 *  - Listado paginado y filtrado de cobranzas.
 *  - Obtención de cobranza individual con detalle (aplicaciones).
 *  - Alta de cobranza con aplicaciones a ventas.
 *  - Baja de cobranza (hard delete, SOLO para correcciones).
 *
 * Tema: Cobranzas / Cuentas Corrientes
 * Capa: Backend - Controllers
 */

import dotenv from 'dotenv';
import { Op } from 'sequelize';
import db from '../../DataBase/db.js';

import { CobranzasClientesModel } from '../../Models/Cobranzas/MD_TB_CobranzasClientes.js';
import { CobranzaAplicacionesModel } from '../../Models/Cobranzas/MD_TB_CobranzaAplicaciones.js';
import { ClientesModel } from '../../Models/Clientes/MD_TB_Clientes.js';
import { VentasModel } from '../../Models/Ventas/MD_TB_Ventas.js';
import { CxcMovimientosModel } from '../../Models/CuentasCorriente/MD_TB_CxcMovimientos.js';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// ======================================================
// Helpers locales
// ======================================================
const normInt = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

const normOptInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limitRaw = parseInt(query.limit, 10);
  const limit = Math.min(100, limitRaw > 0 ? limitRaw : 20);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ======================================================
// Includes base
// ======================================================
const incCliente = {
  model: ClientesModel,
  as: 'cliente',
  attributes: ['id', 'nombre', 'documento', 'telefono', 'email']
};

const incAplicaciones = {
  model: CobranzaAplicacionesModel,
  as: 'aplicaciones',
  include: [
    {
      model: VentasModel,
      as: 'venta',
      attributes: ['id', 'fecha', 'tipo', 'total_neto', 'estado']
    }
  ]
};

// ======================================================
// 1) LISTADO - GET /cobranzas-clientes
// ======================================================
export const OBRS_CobranzasClientes_CTS = async (req, res) => {
  try {
    const { page, limit, offset } = getPagination(req.query || {});
    const { cliente_id, vendedor_id, fecha_desde, fecha_hasta, q } =
      req.query || {};

    const where = {};

    const cliId = normInt(cliente_id);
    if (cliente_id !== undefined && !Number.isFinite(cliId)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'cliente_id debe ser numérico.'
      });
    }
    if (Number.isFinite(cliId)) where.cliente_id = cliId;

    const vendId = normOptInt(vendedor_id);
    if (vendedor_id !== undefined && vendId === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'vendedor_id debe ser numérico.'
      });
    }
    if (vendId !== null) where.vendedor_id = vendId;

    // Rango de fechas
    const dDesde = parseDate(fecha_desde);
    const dHasta = parseDate(fecha_hasta);
    if (dDesde || dHasta) {
      where.fecha = {};
      if (dDesde) where.fecha[Op.gte] = dDesde;
      if (dHasta) where.fecha[Op.lte] = dHasta;
    }

    // Búsqueda rápida por nombre/doc del cliente
    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      where[Op.or] = [
        { '$cliente.nombre$': { [Op.like]: like } },
        { '$cliente.documento$': { [Op.like]: like } }
      ];
    }

    const { rows, count } = await CobranzasClientesModel.findAndCountAll({
      where,
      include: [incCliente],
      order: [
        ['fecha', 'DESC'],
        ['id', 'DESC']
      ],
      limit,
      offset,
      distinct: true,
      subQuery: false
    });

    const totalPages = Math.ceil(count / limit);

    return res.json({
      data: rows,
      meta: {
        total: count,
        page,
        limit,
        totalPages
      }
    });
  } catch (err) {
    console.error('OBRS_CobranzasClientes_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudieron obtener las cobranzas.'
    });
  }
};

// ======================================================
// 2) OBTENER UNA - GET /cobranzas-clientes/:id
// ======================================================
export const OBR_CobranzaCliente_CTS = async (req, res) => {
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID inválido.'
      });
    }

    const row = await CobranzasClientesModel.findByPk(id, {
      include: [incCliente, incAplicaciones]
    });

    if (!row) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cobranza no encontrada.'
      });
    }

    return res.json(row);
  } catch (err) {
    console.error('OBR_CobranzaCliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo obtener la cobranza.'
    });
  }
};

// ======================================================
// 3) CREAR - POST /cobranzas-clientes
//    Body esperado:
//    {
//      cliente_id: 4,
//      vendedor_id: 6,           // opcional
//      fecha: "2025-11-30",
//      total_cobrado: 3500,
//      observaciones: "Reparto 1",
//      aplicaciones: [
//        { venta_id: 12, monto_aplicado: 2000 },
//        { venta_id: 14, monto_aplicado: 1500 },
//        { venta_id: null, monto_aplicado: 1000 } // crédito suelto (opcional)
//      ]
//    }
// ======================================================
export const CR_CobranzaCliente_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const {
      cliente_id,
      vendedor_id,
      fecha,
      total_cobrado,
      observaciones,
      aplicaciones
    } = req.body || {};

    const cliId = normInt(cliente_id);
    if (!Number.isFinite(cliId)) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'cliente_id es obligatorio y numérico.'
      });
    }

    const total = Number(total_cobrado);
    if (!Number.isFinite(total) || total <= 0) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'total_cobrado debe ser mayor a 0.'
      });
    }

    const vendId = normOptInt(vendedor_id);

    // Validar que exista el cliente
    const cli = await ClientesModel.findByPk(cliId, { transaction: t });
    if (!cli) {
      if (!t.finished) await t.rollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cliente no encontrado.'
      });
    }

    // Normalizar fecha
    const fechaCobro = parseDate(fecha) || new Date();

    // ---------- Validación de aplicaciones ----------
    const apps = Array.isArray(aplicaciones) ? aplicaciones : [];
    let sumAplic = 0;

    for (const app of apps) {
      const monto = Number(app.monto_aplicado);
      if (!Number.isFinite(monto) || monto < 0) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError:
            'monto_aplicado en aplicaciones debe ser numérico y >= 0.'
        });
      }
      sumAplic += monto;

      if (
        app.venta_id !== null &&
        app.venta_id !== undefined &&
        !Number.isFinite(normInt(app.venta_id))
      ) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: 'venta_id en aplicaciones debe ser numérico o null.'
        });
      }
    }

    if (sumAplic - total > 0.01) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError:
          'La suma de los montos aplicados no puede superar el total cobrado.'
      });
    }

    // 🔎 (Opcional) Validar que las ventas existan y sean del mismo cliente
    const ventasIds = [
      ...new Set(
        apps.map((a) => normInt(a.venta_id)).filter((id) => Number.isFinite(id))
      )
    ];
    if (ventasIds.length) {
      const ventas = await VentasModel.findAll({
        where: {
          id: ventasIds,
          cliente_id: cliId
        },
        transaction: t
      });
      if (ventas.length !== ventasIds.length) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError:
            'Hay ventas aplicadas que no existen o no pertenecen al cliente.'
        });
      }
    }

    // ---------- Crear cabecera de cobranza ----------
    const nueva = await CobranzasClientesModel.create(
      {
        cliente_id: cliId,
        vendedor_id: vendId,
        fecha: fechaCobro,
        total_cobrado: total,
        observaciones: observaciones?.trim() || null
      },
      { transaction: t }
    );

    // ---------- Crear aplicaciones ----------
    if (apps.length) {
      const rowsApps = apps
        .filter((a) => Number(a.monto_aplicado) > 0)
        .map((a) => ({
          cobranza_id: nueva.id,
          venta_id: normOptInt(a.venta_id),
          monto_aplicado: Number(a.monto_aplicado)
        }));

      if (rowsApps.length) {
        await CobranzaAplicacionesModel.bulkCreate(rowsApps, {
          transaction: t
        });
      }
    }

    // ---------- Registrar movimiento en CxC ----------
    await CxcMovimientosModel.create(
      {
        cliente_id: cliId,
        fecha: fechaCobro,
        signo: -1, // HABER (pago)
        monto: total,
        origen_tipo: 'cobranza',
        origen_id: nueva.id,
        descripcion: `Cobranza #${nueva.id} · Cliente ${cli.nombre}`
      },
      { transaction: t }
    );

    await t.commit();

    const withAll = await CobranzasClientesModel.findByPk(nueva.id, {
      include: [incCliente, incAplicaciones]
    });

    return res.status(201).json(withAll || nueva);
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}

    console.error('CR_CobranzaCliente_CTS error:', err);

    if (
      err?.name === 'SequelizeValidationError' ||
      err?.name === 'ValidationError'
    ) {
      const tips = (err.errors || []).map((e) => e.message);
      return res.status(400).json({
        code: 'MODEL_VALIDATION',
        mensajeError: 'Hay campos inválidos en la cobranza.',
        tips
      });
    }

    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo crear la cobranza.'
    });
  }
};

// ======================================================
// 4) ELIMINAR - DELETE /cobranzas-clientes/:id
//    ⚠ Pensado solo para corrección de pruebas / carga errónea.
//    Si ya integrás CxC en serio, conviene manejar "anulación"
//    lógica en vez de borrar.
// ======================================================
export const ER_CobranzaCliente_CTS = async (req, res) => {
  const t = await db.transaction();
  try {
    const id = normInt(req.params.id);
    if (!Number.isFinite(id)) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID inválido.'
      });
    }

    const row = await CobranzasClientesModel.findByPk(id, { transaction: t });
    if (!row) {
      if (!t.finished) await t.rollback();
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cobranza no encontrada.'
      });
    }

    // Borrar aplicaciones primero (por las dudas, aunque hay ON DELETE CASCADE)
    await CobranzaAplicacionesModel.destroy({
      where: { cobranza_id: id },
      transaction: t
    });

     await CxcMovimientosModel.destroy({
       where: { origen_tipo: 'cobranza', origen_id: id },
       transaction: t
     });

    await row.destroy({ transaction: t });
    await t.commit();

    return res.json({
      ok: true,
      mensaje: 'Cobranza eliminada correctamente.'
    });
  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch {}
    console.error('ER_CobranzaCliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo eliminar la cobranza.'
    });
  }
};
