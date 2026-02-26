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
// Benjamin Orellana - 17/01/2026
// Helpers para aplicar cobranzas a ventas (actualiza ventas.monto_a_cuenta)
// ======================================================
const moneyRound = (n) => Math.round(Number(n || 0) * 100) / 100;

const getSaldoVenta = (ventaRow) => {
  const total = Number(ventaRow?.total_neto ?? 0);
  const aCuenta = Number(ventaRow?.monto_a_cuenta ?? 0);
  return moneyRound(total - aCuenta);
};

async function lockVentaForUpdate(venta_id, transaction) {
  return VentasModel.findByPk(venta_id, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });
}

// FIFO: aplica un monto a ventas abiertas del cliente (fecha ASC, id ASC)
async function aplicarPagoFIFO({
  cliente_id,
  cobranza_id,
  monto,
  transaction
}) {
  let restante = moneyRound(monto);
  const appRows = [];

  if (restante <= 0) return { appRows, restante };

  const ventas = await VentasModel.findAll({
    where: {
      cliente_id,
      estado: 'confirmada',
      tipo: { [Op.in]: ['fiado', 'a_cuenta'] }
    },
    order: [
      ['fecha', 'ASC'],
      ['id', 'ASC']
    ],
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  for (const v of ventas) {
    if (restante <= 0) break;

    const saldo = getSaldoVenta(v);
    if (saldo <= 0) continue;

    const aplicar = moneyRound(Math.min(restante, saldo));
    if (aplicar <= 0) continue;

    const nuevoACuenta = moneyRound(Number(v.monto_a_cuenta ?? 0) + aplicar);

    // Seguridad por constraint: nunca exceder total_neto
    if (nuevoACuenta - Number(v.total_neto ?? 0) > 0.01) {
      const e = new Error(
        `La aplicación excede el total de la venta #${v.id}.`
      );
      e.status = 400;
      throw e;
    }

    await v.update({ monto_a_cuenta: nuevoACuenta }, { transaction });

    appRows.push({
      cobranza_id,
      venta_id: v.id,
      monto_aplicado: aplicar
    });

    restante = moneyRound(restante - aplicar);
  }

  return { appRows, restante };
}

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
//        { venta_id: null, monto_aplicado: 1000, aplica_a: "SALDO_PREVIO" }, // pago a deuda histórica
//        { venta_id: null, monto_aplicado: 500, aplica_a: "CREDITO" }       // crédito suelto
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

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // Lock del cliente para serializar aplicaciones sobre saldo previo y evitar dobles imputaciones concurrentes.
    // ======================================================
    await ClientesModel.findByPk(cliId, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });

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

      // ======================================================
      // Benjamin Orellana - 25-02-2026
      // Validar aplica_a SOLO cuando venta_id es NULL:
      // - SALDO_PREVIO: pago a deuda histórica
      // - CREDITO: crédito suelto/anticipo
      // Si no viene, se asume CREDITO por compatibilidad.
      // ======================================================
      const vIdNorm = normOptInt(app.venta_id);
      if (vIdNorm === null) {
        const aplicaA = String(app.aplica_a || 'CREDITO').trim().toUpperCase();
        if (!['CREDITO', 'SALDO_PREVIO'].includes(aplicaA)) {
          if (!t.finished) await t.rollback();
          return res.status(400).json({
            code: 'BAD_REQUEST',
            mensajeError:
              "aplica_a debe ser 'CREDITO' o 'SALDO_PREVIO' cuando venta_id es null."
          });
        }
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

    //  (Opcional) Validar que las ventas existan y sean del mismo cliente
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

    // ======================================================
    // Benjamin Orellana - 17/01/2026
    // Aplicar cobranza a ventas:
    // - Si vienen aplicaciones => se respetan y además se actualiza ventas.monto_a_cuenta
    // - Si NO vienen aplicaciones => auto FIFO a ventas abiertas (y resto a crédito si sobra)
    // ======================================================
    const appsIn = Array.isArray(aplicaciones) ? aplicaciones : [];

    // Normalizar apps y agrupar por venta_id (evita duplicadas)
    const mapVentaMonto = new Map();
    let creditoExplicito = 0;

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // Nuevo: acumulador para pagos explícitos de saldo previo (deuda histórica)
    // ======================================================
    let saldoPrevioExplicito = 0;

    for (const a of appsIn) {
      const monto = moneyRound(Number(a.monto_aplicado));
      if (!Number.isFinite(monto) || monto <= 0) continue;

      const vId = normOptInt(a.venta_id);

      if (vId === null) {
        const aplicaA = String(a.aplica_a || 'CREDITO').trim().toUpperCase();

        if (aplicaA === 'SALDO_PREVIO') {
          // Benjamin Orellana - 25-02-2026 - Este monto debe descontar saldo_previo_total, no quedar como crédito suelto
          saldoPrevioExplicito = moneyRound(saldoPrevioExplicito + monto);
        } else {
          // CREDITO (default)
          creditoExplicito = moneyRound(creditoExplicito + monto);
        }
      } else {
        mapVentaMonto.set(
          vId,
          moneyRound((mapVentaMonto.get(vId) || 0) + monto)
        );
      }
    }

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // Validación transaccional: el pago explícito a SALDO_PREVIO no puede superar el saldo previo pendiente.
    // Se calcula: sum(DEBE saldo_previo) - sum(aplicado SALDO_PREVIO).
    // ======================================================
    if (saldoPrevioExplicito > 0.01) {
      const [rowsSaldoPrev] = await db.query(
        `
        SELECT
          COALESCE((
            SELECT SUM(m.monto)
            FROM cxc_movimientos m
            WHERE m.cliente_id = :clienteId
              AND m.origen_tipo = 'saldo_previo'
              AND m.signo = 1
          ), 0) AS debe_saldo_previo,
          COALESCE((
            SELECT SUM(ca.monto_aplicado)
            FROM cobranza_aplicaciones ca
            JOIN cobranzas_clientes cc ON cc.id = ca.cobranza_id
            WHERE cc.cliente_id = :clienteId
              AND ca.venta_id IS NULL
              AND ca.aplica_a = 'SALDO_PREVIO'
          ), 0) AS aplicado_saldo_previo
        `,
        { replacements: { clienteId: cliId }, transaction: t }
      );

      const debe = Number(rowsSaldoPrev?.[0]?.debe_saldo_previo || 0);
      const aplicado = Number(rowsSaldoPrev?.[0]?.aplicado_saldo_previo || 0);
      const disponible = moneyRound(Math.max(0, debe - aplicado));

      if (saldoPrevioExplicito - disponible > 0.01) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError:
            'El monto aplicado a saldo previo supera el saldo previo pendiente.',
          tips: [
            `Saldo previo pendiente: ${disponible}`,
            `Monto aplicado a saldo previo: ${saldoPrevioExplicito}`
          ]
        });
      }
    }

    // 1) Si el usuario especificó aplicaciones a ventas, aplicarlas (y actualizar ventas)
    const rowsApps = [];

    const entries = Array.from(mapVentaMonto.entries()).sort(
      (a, b) => a[0] - b[0]
    );
    for (const [venta_id, montoAplic] of entries) {
      const venta = await lockVentaForUpdate(venta_id, t);

      if (!venta || Number(venta.cliente_id) !== Number(cliId)) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError:
            'Hay ventas aplicadas que no existen o no pertenecen al cliente.'
        });
      }

      if (venta.estado !== 'confirmada') {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: `La venta #${venta_id} no está confirmada.`
        });
      }

      const saldo = getSaldoVenta(venta);
      if (montoAplic - saldo > 0.01) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({
          code: 'BAD_REQUEST',
          mensajeError: `Monto aplicado supera saldo de la venta #${venta_id}.`,
          tips: [`Saldo actual: ${saldo}`, `Monto aplicado: ${montoAplic}`]
        });
      }

      const nuevoACuenta = moneyRound(
        Number(venta.monto_a_cuenta ?? 0) + montoAplic
      );
      await venta.update({ monto_a_cuenta: nuevoACuenta }, { transaction: t });

      rowsApps.push({
        cobranza_id: nueva.id,
        venta_id,
        monto_aplicado: montoAplic
      });
    }

    // 2) Si NO vinieron aplicaciones (map vacío y sin crédito explícito), auto aplicar FIFO
    const huboAppsExplicitas =
      mapVentaMonto.size > 0 || creditoExplicito > 0 || saldoPrevioExplicito > 0;

    if (!huboAppsExplicitas) {
      const { appRows, restante } = await aplicarPagoFIFO({
        cliente_id: cliId,
        cobranza_id: nueva.id,
        monto: total,
        transaction: t
      });

      rowsApps.push(...appRows);

      // Si sobra, queda como crédito suelto (venta_id null)
      if (restante > 0.01) {
        rowsApps.push({
          cobranza_id: nueva.id,
          venta_id: null,
          monto_aplicado: restante,
          // Benjamin Orellana - 25-02-2026 - En modo FIFO automático, el sobrante siempre queda como crédito suelto
          aplica_a: 'CREDITO'
        });
      }
    } else {
      // 3) Si vinieron apps explícitas y además vino saldo previo explícito, lo guardamos tal cual
      if (saldoPrevioExplicito > 0.01) {
        rowsApps.push({
          cobranza_id: nueva.id,
          venta_id: null,
          monto_aplicado: saldoPrevioExplicito,
          // Benjamin Orellana - 25-02-2026 - Marca explícita para descontar deuda histórica en el cálculo de saldo_previo_total
          aplica_a: 'SALDO_PREVIO'
        });
      }

      // 4) Si vinieron apps explícitas y además vino crédito explícito, lo guardamos tal cual
      if (creditoExplicito > 0.01) {
        rowsApps.push({
          cobranza_id: nueva.id,
          venta_id: null,
          monto_aplicado: creditoExplicito,
          // Benjamin Orellana - 25-02-2026 - Crédito suelto/anticipo (no afecta saldo_previo_total)
          aplica_a: 'CREDITO'
        });
      }

      // 5) Si apps explícitas no cubren el total, el resto también va a crédito suelto (determinista)
      const sumRows = moneyRound(
        rowsApps.reduce((acc, r) => acc + Number(r.monto_aplicado || 0), 0)
      );

      const resto = moneyRound(total - sumRows);
      if (resto > 0.01) {
        rowsApps.push({
          cobranza_id: nueva.id,
          venta_id: null,
          monto_aplicado: resto,
          // Benjamin Orellana - 25-02-2026 - Resto determinista siempre a crédito suelto
          aplica_a: 'CREDITO'
        });
      }
    }

    // 5) Persistir aplicaciones (si hay)
    if (rowsApps.length) {
      await CobranzaAplicacionesModel.bulkCreate(rowsApps, { transaction: t });
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
//     Pensado solo para corrección de pruebas / carga errónea.
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

    // ======================================================
    // Benjamin Orellana - 17/01/2026
    // Revertir efectos en ventas.monto_a_cuenta antes de borrar
    // ======================================================
    const apps = await CobranzaAplicacionesModel.findAll({
      where: { cobranza_id: id },
      transaction: t,
      raw: true
    });

    for (const a of apps) {
      if (!a.venta_id) continue;

      const venta = await lockVentaForUpdate(a.venta_id, t);
      if (!venta) continue;

      const nuevoACuenta = moneyRound(
        Number(venta.monto_a_cuenta ?? 0) - Number(a.monto_aplicado ?? 0)
      );

      await venta.update(
        { monto_a_cuenta: Math.max(0, nuevoACuenta) },
        { transaction: t }
      );
    }

    // Borrar aplicaciones
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

// ======================================================
// Helper interno reutilizable
//  - Registrar una cobranza "a cuenta" asociada a UNA venta
//  - Se usa desde otros módulos (ej: ventas por reparto)
// ======================================================
export async function registrarCobranzaACuentaPorVenta(
  {
    cliente_id,
    vendedor_id = null,
    fecha,
    montoACuenta,
    venta_id,
    observacionesExtra
  },
  transaction
) {
  const total = Number(montoACuenta);

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  const fechaCobro =
    fecha instanceof Date
      ? fecha
      : (() => {
          const d = new Date(fecha || Date.now());
          return Number.isNaN(d.getTime()) ? new Date() : d;
        })();

  const vendId = normOptInt(vendedor_id);

  // 1) Cabecera de cobranza
  const cobranza = await CobranzasClientesModel.create(
    {
      cliente_id,
      vendedor_id: vendId,
      fecha: fechaCobro,
      total_cobrado: total,
      observaciones:
        observacionesExtra ||
        `Pago a cuenta aplicado automáticamente a la venta #${venta_id}`
    },
    { transaction }
  );

  // 2) Movimiento en CxC (HABER = pago)
  await CxcMovimientosModel.create(
    {
      cliente_id,
      fecha: fechaCobro,
      signo: -1,
      monto: total,
      origen_tipo: 'cobranza',
      origen_id: cobranza.id,
      descripcion:
        observacionesExtra ||
        `Cobranza a cuenta generada para venta #${venta_id}`
    },
    { transaction }
  );

  // ======================================================
  // Benjamin Orellana - 17/01/2026
  // Aplicar el pago a la venta (actualiza ventas.monto_a_cuenta)
  // ======================================================
  const venta = await VentasModel.findByPk(venta_id, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!venta || Number(venta.cliente_id) !== Number(cliente_id)) {
    const e = new Error('VENTA_NO_VALIDA_PARA_CLIENTE');
    e.status = 400;
    throw e;
  }

  if (venta.estado !== 'confirmada') {
    const e = new Error('VENTA_NO_CONFIRMADA');
    e.status = 400;
    throw e;
  }

  const saldo = getSaldoVenta(venta);
  if (total - saldo > 0.01) {
    const e = new Error('PAGO_SUPERA_SALDO_VENTA');
    e.status = 400;
    throw e;
  }

  await venta.update(
    { monto_a_cuenta: moneyRound(Number(venta.monto_a_cuenta ?? 0) + total) },
    { transaction }
  );

  // 3) Aplicación a la venta
  await CobranzaAplicacionesModel.create(
    {
      cobranza_id: cobranza.id,
      venta_id,
      monto_aplicado: total
    },
    { transaction }
  );

  return cobranza;
}
