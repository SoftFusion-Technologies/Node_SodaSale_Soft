/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 30 / 11 / 2025
 * Versión: 1.0
 *
 * Descripción:
 *  Endpoints de consulta de Cuentas Corrientes (CxC) por cliente.
 *  - Deuda detallada por cliente (ventas pendientes).
 *
 * Tema: Cobranzas / Cuentas Corrientes
 * Capa: Backend - Controllers
 */

import dotenv from 'dotenv';
import { Op } from 'sequelize';
import db from '../../DataBase/db.js';

import { ClientesModel } from '../../Models/Clientes/MD_TB_Clientes.js';
import { VentasModel } from '../../Models/Ventas/MD_TB_Ventas.js';
import { CobranzaAplicacionesModel } from '../../Models/Cobranzas/MD_TB_CobranzaAplicaciones.js';
import { CobranzasClientesModel } from '../../Models/Cobranzas/MD_TB_CobranzasClientes.js';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const normInt = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};
// GET /cxc/clientes/:id/deuda
// Devuelve:
// {
//   cliente: { ... },
//   total_deuda: 10500.00,
//   saldo_previo_total: 45000.00,
//   saldos_previos: [ { id, fecha, monto, descripcion } ],
//   ventas_pendientes: [
//     { id, fecha, tipo, total_venta, cobrado, saldo, dias_atraso }
//   ]
// }
// ======================================================
export const OBR_CxcDeudaCliente_CTS = async (req, res) => {
  try {
    const clienteId = normInt(req.params.id);
    if (!Number.isFinite(clienteId)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        mensajeError: 'ID de cliente inválido.'
      });
    }

    // 1) Cliente
    const cliente = await ClientesModel.findByPk(clienteId);
    if (!cliente) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        mensajeError: 'Cliente no encontrado.'
      });
    }

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // 1.b) Saldos previos (deuda histórica) desde CxC (DEBEs)
    // ======================================================
    const [saldosPrevRows] = await db.query(
      `
      SELECT
        id,
        fecha,
        monto,
        descripcion
      FROM cxc_movimientos
      WHERE cliente_id = :clienteId
        AND origen_tipo = 'saldo_previo'
        AND signo = 1
      ORDER BY fecha ASC, id ASC
      `,
      { replacements: { clienteId } }
    );

    const saldosPreviosDebe = (Array.isArray(saldosPrevRows) ? saldosPrevRows : [])
      .map((r) => ({
        id: Number(r.id),
        fecha: r.fecha,
        monto: Number(r.monto) || 0,
        descripcion: r.descripcion || null
      }))
      .filter((r) => Number(r.monto) > 0);

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // 1.c) Total aplicado explícitamente a SALDO_PREVIO (para descontar la deuda histórica)
    // ======================================================
    const [aplicadoRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(ca.monto_aplicado), 0) AS total_aplicado
      FROM cobranza_aplicaciones ca
      JOIN cobranzas_clientes cc ON cc.id = ca.cobranza_id
      WHERE cc.cliente_id = :clienteId
        AND ca.venta_id IS NULL
        AND ca.aplica_a = 'SALDO_PREVIO'
      `,
      { replacements: { clienteId } }
    );

    const aplicadoSaldoPrevioTotal = Number(aplicadoRows?.[0]?.total_aplicado || 0);

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // 1.d) “FIFO” sobre saldos previos: restamos el total aplicado y devolvemos solo los pendientes.
    // - Mantiene el listado consistente con saldo_previo_total.
    // - Se devuelve monto = pendiente (y monto_original como extra opcional).
    // ======================================================
    let restanteAplicado = Number(aplicadoSaldoPrevioTotal || 0);
    const saldosPrevios = [];

    for (const sp of saldosPreviosDebe) {
      const original = Number(sp.monto || 0);
      if (original <= 0) continue;

      let usado = 0;
      if (restanteAplicado > 0.01) {
        usado = Math.min(original, restanteAplicado);
        restanteAplicado = Number((restanteAplicado - usado).toFixed(2));
      }

      const pendiente = Number((original - usado).toFixed(2));
      if (pendiente > 0.01) {
        saldosPrevios.push({
          id: sp.id,
          fecha: sp.fecha,
          monto: pendiente, // pendiente real
          // Benjamin Orellana - 25-02-2026 - Campo extra no rompe al frontend; útil para auditoría/UX futura
          monto_original: original,
          descripcion: sp.descripcion
        });
      }
    }

    const saldoPrevioTotal = Number(
      saldosPrevios.reduce((acc, r) => acc + Number(r.monto || 0), 0).toFixed(2)
    );

    // 2) Ventas fiadas / a cuenta confirmadas de ese cliente
    const ventas = await VentasModel.findAll({
      where: {
        cliente_id: clienteId,
        estado: 'confirmada',
        tipo: { [Op.in]: ['fiado', 'a_cuenta'] }
      },
      order: [
        ['fecha', 'ASC'],
        ['id', 'ASC']
      ]
    });

    // Si no hay ventas, igual devolvemos saldos previos (pendientes)
    if (!ventas.length) {
      return res.json({
        cliente: {
          id: cliente.id,
          nombre: cliente.nombre,
          documento: cliente.documento,
          telefono: cliente.telefono,
          email: cliente.email
        },
        total_deuda: Number(saldoPrevioTotal.toFixed(2)),
        // Benjamin Orellana - 25-02-2026
        saldo_previo_total: saldoPrevioTotal,
        saldos_previos: saldosPrevios,
        ventas_pendientes: []
      });
    }

    const ventasIds = ventas.map((v) => v.id);

    // 3) Sumar aplicaciones de cobranzas por venta
    const appsAgg = await CobranzaAplicacionesModel.unscoped().findAll({
      attributes: [
        'venta_id',
        [db.fn('SUM', db.col('monto_aplicado')), 'total_aplicado']
      ],
      where: {
        venta_id: { [Op.in]: ventasIds }
      },
      group: ['venta_id'],
      order: [],
      raw: true
    });

    const mapApps = {};
    for (const row of appsAgg) {
      mapApps[row.venta_id] = Number(row.total_aplicado) || 0;
    }

    const hoy = new Date();
    const ventasPendientes = [];
    let totalDeudaVentas = 0;

    for (const v of ventas) {
      const totalVenta = Number(v.total_neto) || 0;

      // ======================================================
      // Benjamin Orellana - 25-02-2026
      // Cobrado canónico: ventas.monto_a_cuenta
      // Compat: si hay apps, tomamos el máximo para evitar doble conteo.
      // ======================================================
      const aCuentaVenta = Number(v.monto_a_cuenta) || 0;
      const aplicadoApps = mapApps[v.id] || 0;
      const cobrado = Math.max(aCuentaVenta, aplicadoApps);

      const saldo = Number((totalVenta - cobrado).toFixed(2));
      if (saldo <= 0.01) continue;

      const fechaVenta = new Date(v.fecha);
      const diffMs = hoy.getTime() - fechaVenta.getTime();
      const dias_atraso = Math.max(
        0,
        Math.floor(diffMs / (1000 * 60 * 60 * 24))
      );

      ventasPendientes.push({
        id: v.id,
        fecha: v.fecha,
        tipo: v.tipo,
        total_venta: totalVenta,
        cobrado,
        saldo,
        dias_atraso
      });

      totalDeudaVentas += saldo;
    }

    totalDeudaVentas = Number(totalDeudaVentas.toFixed(2));

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // Deuda total = ventas pendientes + saldo previo pendiente (neto)
    // ======================================================
    const totalDeuda = Number((totalDeudaVentas + saldoPrevioTotal).toFixed(2));

    return res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        documento: cliente.documento,
        telefono: cliente.telefono,
        email: cliente.email
      },
      total_deuda: totalDeuda,
      saldo_previo_total: saldoPrevioTotal,
      saldos_previos: saldosPrevios,
      ventas_pendientes: ventasPendientes
    });
  } catch (err) {
    console.error('OBR_CxcDeudaCliente_CTS error:', err);
    return res.status(500).json({
      code: 'SERVER_ERROR',
      mensajeError: 'No se pudo obtener la deuda del cliente.'
    });
  }
};