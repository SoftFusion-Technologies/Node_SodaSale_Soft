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

// ======================================================
// GET /cxc/clientes/:id/deuda
// Devuelve:
// {
//   cliente: { ... },
//   total_deuda: 10500.00,
//   ventas_pendientes: [
//     {
//       id,
//       fecha,
//       tipo,
//       total_venta,
//       cobrado,
//       saldo,
//       dias_atraso
//     }
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

    if (!ventas.length) {
      return res.json({
        cliente: {
          id: cliente.id,
          nombre: cliente.nombre,
          documento: cliente.documento,
          telefono: cliente.telefono,
          email: cliente.email
        },
        total_deuda: 0,
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
    let totalDeuda = 0;

    for (const v of ventas) {
      const totalVenta = Number(v.total_neto) || 0;
      const cobrado = mapApps[v.id] || 0;
      const saldo = Number((totalVenta - cobrado).toFixed(2));

      if (saldo <= 0.01) continue; // ya está saldada o casi

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

      totalDeuda += saldo;
    }

    totalDeuda = Number(totalDeuda.toFixed(2));

    return res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        documento: cliente.documento,
        telefono: cliente.telefono,
        email: cliente.email
      },
      total_deuda: totalDeuda,
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
