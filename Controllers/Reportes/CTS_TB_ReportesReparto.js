/*
 * Programador: Benjamin Orellana
 * Fecha Actualización: 30 / 11 / 2025
 * Versión: 1.1
 *
 * Descripción:
 *  Reporte de Reparto & Cobranza por Reparto (zona de reparto).
 *  - Filtra por reparto_id (obligatorio).
 *  - Trae clientes asignados a ese reparto (tabla reparto_clientes).
 *  - Calcula deuda actual por cliente (cxc_movimientos).
 *  - Calcula ventas fiado pendientes por cliente (ventas + cobranza_aplicaciones).
 *  - Sugiere productos habituales por cliente (ventas_detalle).
 *
 * Endpoints:
 *  GET  /reportes/reparto-cobranza
 *  GET  /reportes/reparto-cobranza/pdf
 */

import dotenv from 'dotenv';
import { Op, fn, col, literal } from 'sequelize';

import { RepartosModel } from '../../Models/Repartos/MD_TB_Repartos.js';
import { RepartoClientesModel } from '../../Models/Repartos/MD_TB_RepartoClientes.js';
import { ClientesModel } from '../../Models/Clientes/MD_TB_Clientes.js';
import { CxcMovimientosModel } from '../../Models/CuentasCorriente/MD_TB_CxcMovimientos.js';
import { VentasModel } from '../../Models/Ventas/MD_TB_Ventas.js';
import { VentasDetalleModel } from '../../Models/Ventas/MD_TB_VentasDetalle.js';
import { ProductosModel } from '../../Models/Productos/MD_TB_Productos.js';
import { CobranzaAplicacionesModel } from '../../Models/Cobranzas/MD_TB_CobranzaAplicaciones.js';

import puppeteer from 'puppeteer';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

/* ============================================================
 * Helpers
 * ============================================================ */

const parseDate = (v, endOfDay = false) => {
  if (!v) return null;
  const str = endOfDay ? `${v}T23:59:59` : `${v}T00:00:00`;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normInt = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

function moneyAR(n) {
  return (Number(n) || 0).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  });
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  });
}

/* ============================================================
 * 1) LÓGICA COMPARTIDA: arma el objeto de reporte
 * ============================================================ */

async function obtenerReporteRepartoCobranzaDatos(query) {
  const {
    reparto_id,
    fecha_desde,
    fecha_hasta,
    solo_con_deuda // '1' | 'true' | undefined
  } = query || {};

  const repId = normInt(reparto_id);
  if (!Number.isFinite(repId)) {
    const error = new Error('reparto_id es obligatorio y debe ser numérico.');
    error.statusCode = 400;
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const dDesde = parseDate(fecha_desde, false);
  const dHasta = parseDate(fecha_hasta, true);

  const soloConDeuda =
    String(solo_con_deuda || '')
      .trim()
      .toLowerCase() === '1' ||
    String(solo_con_deuda || '')
      .trim()
      .toLowerCase() === 'true';

  // 1) Reparto
  const reparto = await RepartosModel.findByPk(repId, {
    attributes: [
      'id',
      'ciudad_id',
      'nombre',
      'rango_min',
      'rango_max',
      'estado'
    ]
  });

  if (!reparto) {
    const error = new Error('Reparto no encontrado.');
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  // 2) Clientes del reparto
  const repClientes = await RepartoClientesModel.findAll({
    where: {
      reparto_id: repId,
      estado: 'activo'
    },
    include: [
      {
        model: ClientesModel,
        as: 'cliente',
        attributes: ['id', 'nombre', 'documento', 'telefono', 'email', 'estado']
      }
    ],
    order: [['numero_rango', 'ASC']]
  });

  const clientesBase = [];
  const clienteIds = new Set();

  for (const rc of repClientes) {
    if (!rc.cliente) continue;
    if (rc.cliente.estado !== 'activo') continue; // solo clientes activos

    clientesBase.push({
      cliente_id: rc.cliente.id,
      numero_rango: rc.numero_rango,
      cliente: {
        id: rc.cliente.id,
        nombre: rc.cliente.nombre,
        documento: rc.cliente.documento,
        telefono: rc.cliente.telefono,
        email: rc.cliente.email
      }
    });

    clienteIds.add(rc.cliente.id);
  }

  const clienteIdList = Array.from(clienteIds);

  if (!clienteIdList.length) {
    // Reparto sin clientes
    return {
      filtros: {
        reparto_id: repId,
        fecha_desde: dDesde ? fecha_desde : null,
        fecha_hasta: dHasta ? fecha_hasta : null,
        solo_con_deuda: !!soloConDeuda
      },
      reparto,
      resumen: {
        total_clientes: 0,
        deuda_total_zona: 0,
        total_clientes_con_deuda: 0
      },
      clientes: []
    };
  }

  const hoy = new Date();

  // 3) Saldos por cliente (CxC)
  const saldosRows = await CxcMovimientosModel.unscoped().findAll({
    where: { cliente_id: { [Op.in]: clienteIdList } },
    attributes: ['cliente_id', [fn('SUM', literal('signo * monto')), 'saldo']],
    group: ['cliente_id'],
    order: [],
    raw: true
  });

  const saldosByCliente = new Map();
  for (const row of saldosRows) {
    const cliId = Number(row.cliente_id);
    const saldo = Number(row.saldo) || 0;
    saldosByCliente.set(cliId, saldo);
  }

  // 4) Ventas fiado confirmadas
  const whereVentasFiado = {
    cliente_id: { [Op.in]: clienteIdList },
    tipo: 'fiado',
    estado: 'confirmada'
  };

  if (dDesde || dHasta) {
    whereVentasFiado.fecha = {};
    if (dDesde) whereVentasFiado.fecha[Op.gte] = dDesde;
    if (dHasta) whereVentasFiado.fecha[Op.lte] = dHasta;
  }

  const ventasFiado = await VentasModel.findAll({
    where: whereVentasFiado,
    attributes: ['id', 'cliente_id', 'fecha', 'tipo', 'total_neto', 'estado'],
    order: [
      ['cliente_id', 'ASC'],
      ['fecha', 'ASC']
    ]
  });

  // 5) Aplicaciones de cobranza por venta
  let appsByVenta = new Map();

  if (ventasFiado.length) {
    const ventasIds = ventasFiado.map((v) => v.id);

    const apps = await CobranzaAplicacionesModel.unscoped().findAll({
      where: {
        venta_id: { [Op.in]: ventasIds }
      },
      attributes: [
        'venta_id',
        [fn('SUM', col('monto_aplicado')), 'total_aplicado']
      ],
      group: ['venta_id'],
      order: [],
      raw: true
    });

    appsByVenta = new Map(
      apps.map((row) => [Number(row.venta_id), Number(row.total_aplicado) || 0])
    );
  }

  const ventasPendientesPorCliente = new Map();
  const resumenFiadoPorCliente = new Map();

  for (const v of ventasFiado) {
    const totalVenta = Number(v.total_neto) || 0;
    const aplicado = appsByVenta.get(v.id) || 0;
    const saldoVenta = Math.max(0, totalVenta - aplicado);

    // ignoramos ventas totalmente cobradas
    if (saldoVenta <= 0.01) continue;

    const cliId = Number(v.cliente_id);
    const arr = ventasPendientesPorCliente.get(cliId) || [];

    arr.push({
      id: v.id,
      fecha: v.fecha,
      tipo: v.tipo,
      estado: v.estado,
      total_neto: totalVenta,
      saldo_pendiente: saldoVenta
    });

    ventasPendientesPorCliente.set(cliId, arr);
  }

  // Resumen fiado por cliente
  for (const [cliId, arr] of ventasPendientesPorCliente.entries()) {
    let fechaMasVieja = null;
    let diasMaxAtraso = 0;

    for (const v of arr) {
      const fv = new Date(v.fecha);
      if (!fechaMasVieja || fv < fechaMasVieja) {
        fechaMasVieja = fv;
      }
      const diffMs = hoy - fv;
      const diffDias = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      if (diffDias > diasMaxAtraso) {
        diasMaxAtraso = diffDias;
      }
    }

    resumenFiadoPorCliente.set(cliId, {
      ventas_abiertas: arr.length,
      fecha_venta_mas_vieja: fechaMasVieja,
      dias_max_atraso: diasMaxAtraso
    });
  }

  // 6) Productos habituales
  const whereVentasStats = {
    cliente_id: { [Op.in]: clienteIdList },
    estado: 'confirmada'
  };
  if (dDesde || dHasta) {
    whereVentasStats.fecha = {};
    if (dDesde) whereVentasStats.fecha[Op.gte] = dDesde;
    if (dHasta) whereVentasStats.fecha[Op.lte] = dHasta;
  }

  const topProductosRows = await VentasDetalleModel.unscoped().findAll({
    attributes: [
      [col('venta.cliente_id'), 'cliente_id'],
      'producto_id',
      [fn('SUM', col('cantidad')), 'total_cantidad'],
      [col('producto.nombre'), 'producto_nombre'],
      [fn('MAX', col('precio_unit')), 'precio_ultimo']
    ],
    include: [
      {
        model: VentasModel,
        as: 'venta',
        attributes: [],
        where: whereVentasStats
      },
      {
        model: ProductosModel,
        as: 'producto',
        attributes: []
      }
    ],
    group: [
      col('venta.cliente_id'),
      col('producto_id'),
      col('producto.nombre')
    ],
    order: [],
    raw: true
  });

  const productosSugeridosPorCliente = new Map();

  for (const row of topProductosRows) {
    const cliId = Number(row.cliente_id);
    const arr = productosSugeridosPorCliente.get(cliId) || [];
    arr.push({
      producto_id: row.producto_id,
      nombre: row.producto_nombre,
      precio_ultimo: Number(row.precio_ultimo) || 0,
      total_cantidad: Number(row.total_cantidad) || 0
    });
    productosSugeridosPorCliente.set(cliId, arr);
  }

  const TOP_N_PRODUCTOS = 5;
  for (const [cliId, arr] of productosSugeridosPorCliente.entries()) {
    arr.sort((a, b) => b.total_cantidad - a.total_cantidad);
    productosSugeridosPorCliente.set(cliId, arr.slice(0, TOP_N_PRODUCTOS));
  }

  // 7) Armar respuesta final
  const clientesResp = [];
  let deudaTotalZona = 0;
  let totalClientesConDeuda = 0;

  for (const base of clientesBase) {
    const cliId = base.cliente_id;
    const saldoCliente = Number(saldosByCliente.get(cliId) || 0);

    if (soloConDeuda && saldoCliente <= 0.01) continue;

    const ventasPend = ventasPendientesPorCliente.get(cliId) || [];
    const resumenFiado = resumenFiadoPorCliente.get(cliId) || {
      ventas_abiertas: 0,
      fecha_venta_mas_vieja: null,
      dias_max_atraso: 0
    };
    const productosSug = productosSugeridosPorCliente.get(cliId) || [];

    deudaTotalZona += saldoCliente;
    if (saldoCliente > 0.01) totalClientesConDeuda += 1;

    clientesResp.push({
      cliente: base.cliente,
      reparto: {
        id: reparto.id,
        nombre: reparto.nombre,
        numero_rango: base.numero_rango
      },
      deuda_total: saldoCliente,
      resumen_fiado: resumenFiado,
      ventas_pendientes: ventasPend,
      productos_sugeridos: productosSug
    });
  }

  return {
    filtros: {
      reparto_id: repId,
      fecha_desde: dDesde ? fecha_desde : null,
      fecha_hasta: dHasta ? fecha_hasta : null,
      solo_con_deuda: !!soloConDeuda
    },
    reparto: {
      id: reparto.id,
      ciudad_id: reparto.ciudad_id,
      nombre: reparto.nombre,
      rango_min: reparto.rango_min,
      rango_max: reparto.rango_max,
      estado: reparto.estado
    },
    resumen: {
      total_clientes: clientesResp.length,
      deuda_total_zona: deudaTotalZona,
      total_clientes_con_deuda: totalClientesConDeuda
    },
    clientes: clientesResp
  };
}

/* ============================================================
 * 2) Endpoint JSON
 * ============================================================ */

export const OBR_ReporteRepartoCobranza_CTS = async (req, res) => {
  try {
    const data = await obtenerReporteRepartoCobranzaDatos(req.query || {});
    return res.json(data);
  } catch (err) {
    console.error('OBR_ReporteRepartoCobranza_CTS error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      code: err.code || 'SERVER_ERROR',
      mensajeError:
        err.message || 'No se pudo obtener el reporte de reparto & cobranza.'
    });
  }
};

/* ============================================================
 * 3) Builder HTML para PDF
 * ============================================================ */

function buildReporteRepartoCobranzaHtml(data) {
  const { filtros, reparto, resumen, clientes } = data;
  const ahora = new Date().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const filtrosTexto = [
    reparto?.nombre ? `Reparto: ${reparto.nombre}` : null,
    filtros.fecha_desde ? `Desde: ${fmtFecha(filtros.fecha_desde)}` : null,
    filtros.fecha_hasta ? `Hasta: ${fmtFecha(filtros.fecha_hasta)}` : null,
    filtros.solo_con_deuda ? 'Solo clientes con deuda' : 'Todos los clientes'
  ]
    .filter(Boolean)
    .join(' · ');

  const clientesHtml = (clientes || [])
    .map((item) => {
      const { cliente, deuda_total, resumen_fiado, productos_sugeridos } = item;
      const resumenFiado = resumen_fiado || {
        ventas_abiertas: 0,
        fecha_venta_mas_vieja: null,
        dias_max_atraso: 0
      };

      const ventasPend = item.ventas_pendientes || [];

      // --------------------------
      // Ventas fiado pendientes
      // --------------------------
      let ventasPendHtml;
      if (!ventasPend.length) {
        ventasPendHtml = `
          <div class="subtitle">Ventas fiado pendientes</div>
          <div class="text-body">
            Este cliente no tiene ventas fiado pendientes en el rango filtrado.
          </div>
        `;
      } else {
        const filas = ventasPend
          .map(
            (v) => `
              <tr>
                <td>Venta #${v.id}</td>
                <td>${fmtFecha(v.fecha)}</td>
                <td class="text-right">${moneyAR(v.total_neto)}</td>
                <td class="text-right">${moneyAR(v.saldo_pendiente)}</td>
                <td class="text-right">${v.estado}</td>
              </tr>
            `
          )
          .join('');

        ventasPendHtml = `
          <div class="subtitle">Ventas fiado pendientes</div>
          <table class="tabla-ventas">
            <thead>
              <tr>
                <th>Venta</th>
                <th>Fecha</th>
                <th class="text-right">Total</th>
                <th class="text-right">Saldo</th>
                <th class="text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${filas}
            </tbody>
          </table>
        `;
      }

      // --------------------------
      // Planeo de reparto (para escribir a mano)
      // --------------------------
      let productosPlaneoHtml;
      const prods = productos_sugeridos || [];

      if (!prods.length) {
        productosPlaneoHtml = `
          <div class="text-body">
            No hay productos sugeridos para este cliente en el rango filtrado.
          </div>
        `;
      } else {
        productosPlaneoHtml = prods
          .map(
            (p) => `
              <div class="planeo-producto">
                <div class="planeo-producto-main">
                  <span class="planeo-producto-nombre">${p.nombre}</span>
                  <span class="planeo-producto-precio">${moneyAR(
                    p.precio_ultimo
                  )}</span>
                </div>
                <div class="planeo-producto-extra">
                  <span class="planeo-label-sm">Cant:</span>
                  <span class="planeo-cant-box"></span>
                  ${
                    p.total_cantidad
                      ? `<span class="planeo-hist">(Hist: ${p.total_cantidad})</span>`
                      : ''
                  }
                </div>
              </div>
            `
          )
          .join('\n');
      }

      return `
        <div class="card-cliente">
          <div class="card-header">
            <div class="cliente-inicial">
              ${(cliente.nombre || '?').trim().charAt(0).toUpperCase()}
            </div>
            <div class="cliente-datos">
              <div class="cliente-nombre">${
                cliente.nombre || 'Cliente sin nombre'
              }</div>
              <div class="cliente-doc">
                ${
                  cliente.documento
                    ? `DNI/CUIT: ${cliente.documento}`
                    : 'Sin documento'
                }
              </div>
              <div class="cliente-contacto">
                ${cliente.telefono ? `Tel: ${cliente.telefono}` : ''}
                ${cliente.telefono && cliente.email ? ' · ' : ''}
                ${cliente.email || ''}
              </div>
            </div>
            <div class="cliente-deuda">
              <div class="tag-deuda">Deuda total</div>
              <div class="deuda-importe">${moneyAR(deuda_total || 0)}</div>
              <div class="deuda-resumen">
                ${resumenFiado.ventas_abiertas} venta(s) fiado pendiente ·
                ${resumenFiado.dias_max_atraso || 0} día(s) de atraso máx.
              </div>
              ${
                resumenFiado.fecha_venta_mas_vieja
                  ? `<div class="deuda-resumen">Venta más vieja: ${fmtFecha(
                      resumenFiado.fecha_venta_mas_vieja
                    )}</div>`
                  : ''
              }
            </div>
          </div>

          <div class="card-body">
            <div class="col">
              ${ventasPendHtml}
            </div>
            <div class="col">
              <div class="subtitle planeo-title">
                Planeo de reparto (para completar en ruta)
              </div>
              <div class="planeo-ayuda">
                Marcá cantidades y anotaciones al momento del reparto.
              </div>
              <div class="subtitle planeo-subtitle-sec">
                Productos sugeridos (historial de fiado)
              </div>
              <div class="planeo-productos">
                ${productosPlaneoHtml}
              </div>
              <div class="planeo-observacion">
                <div class="planeo-observ-label">
                  Observación para el reparto (opcional):
                </div>
                <div class="planeo-observ-box"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('\n');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Reporte Reparto & Cobranza</title>
<style>
  @page {
    size: A4;
    margin: 12mm 10mm 18mm 10mm;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    font-size: 11px;
    color: #e5e7eb;
    background: radial-gradient(circle at top, #020617 0, #020617 40%, #020617 100%);
  }
  .wrapper {
    padding: 10mm 4mm 12mm 4mm;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(251, 191, 36, 0.4);
  }
  .logo-titulo {
    max-width: 65%;
  }
  .logo-small {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(248, 250, 252, 0.7);
  }
  h1 {
    margin: 2px 0 3px 0;
    font-size: 20px;
    color: #facc15;
  }
  .subtitle {
    font-size: 10px;
    color: rgba(248, 250, 252, 0.7);
  }
  .meta {
    text-align: right;
    font-size: 9px;
    color: rgba(248, 250, 252, 0.75);
  }
  .meta strong {
    color: #fef3c7;
  }
  .filtros-box {
    margin-top: 4px;
    font-size: 9px;
    color: rgba(248, 250, 252, 0.7);
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0,1fr));
    gap: 6px;
    margin-bottom: 10px;
  }
  .kpi-card {
    background: radial-gradient(circle at top left,#0f172a,#020617);
    border-radius: 10px;
    border: 1px solid rgba(148,163,184,0.7);
    padding: 6px 8px;
  }
  .kpi-label {
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(248,250,252,0.7);
  }
  .kpi-value {
    margin-top: 2px;
    font-size: 15px;
    font-weight: 600;
    color: #fef9c3;
  }

  .clientes-section-title {
    margin: 10px 0 4px 0;
    font-size: 11px;
    font-weight: 600;
    color: #fef3c7;
  }

  .card-cliente {
    background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(15,23,42,0.9));
    border-radius: 14px;
    border: 1px solid rgba(148,163,184,0.7);
    padding: 8px 9px;
    margin-bottom: 6px;
    page-break-inside: avoid;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 6px;
  }
  .cliente-inicial {
    width: 22px;
    height: 22px;
    border-radius: 10px;
    background: rgba(250,204,21,0.16);
    border: 1px solid rgba(250,204,21,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: #fef9c3;
  }
  .cliente-datos { flex: 1 1 auto; }
  .cliente-nombre {
    font-size: 11px;
    font-weight: 600;
    color: #fef9c3;
  }
  .cliente-doc, .cliente-contacto {
    font-size: 9px;
    color: rgba(248,250,252,0.7);
  }
  .cliente-deuda {
    min-width: 130px;
    text-align: right;
  }
  .tag-deuda {
    font-size: 8px;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: rgba(110,231,183,0.8);
  }
  .deuda-importe {
    margin-top: 1px;
    font-size: 13px;
    font-weight: 600;
    color: #bbf7d0;
  }
  .deuda-resumen {
    font-size: 9px;
    color: rgba(248,250,252,0.7);
  }

  .card-body {
    display: grid;
    grid-template-columns: minmax(0,1.6fr) minmax(0,1.2fr);
    column-gap: 14px;
    margin-top: 4px;
  }
  .col {
    flex: 1 1 0;
  }
  .card-body .col:last-child {
    padding-left: 10px;
    border-left: 1px dashed rgba(148,163,184,0.45);
  }

  .tabla-ventas {
    width: 100%;
    border-collapse: collapse;
    margin-top: 2px;
  }
  .tabla-ventas th,
  .tabla-ventas td {
    padding: 2px 3px;
    font-size: 8.5px;
  }
  .tabla-ventas thead {
    background: rgba(15,23,42,0.9);
  }
  .tabla-ventas th {
    text-align: left;
    color: rgba(248,250,252,0.8);
    border-bottom: 1px solid rgba(148,163,184,0.6);
  }
  .tabla-ventas td {
    border-bottom: 1px solid rgba(30,41,59,0.7);
  }
  .text-right { text-align: right; }

  .text-body {
    font-size: 9px;
    color: rgba(248,250,252,0.8);
  }

  /* Planeo de reparto */

  .planeo-title {
    margin-bottom: 1px;
  }
  .planeo-ayuda {
    font-size: 8px;
    color: rgba(148,163,184,0.95);
    margin-bottom: 3px;
  }
  .planeo-subtitle-sec {
    margin-top: 2px;
    margin-bottom: 2px;
  }
  .planeo-productos {
    margin-top: 1px;
  }
  .planeo-producto {
    border-radius: 8px;
    border: 1px solid rgba(148,163,184,0.8);
    padding: 3px 5px;
    margin-bottom: 3px;
    background: rgba(15,23,42,0.85);
  }
  .planeo-producto-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .planeo-producto-nombre {
    font-size: 9px;
    font-weight: 600;
    color: #fefce8;
  }
  .planeo-producto-precio {
    font-size: 9px;
    color: #bbf7d0;
  }
  .planeo-producto-extra {
    margin-top: 1px;
    font-size: 8.5px;
    color: rgba(248,250,252,0.85);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .planeo-label-sm {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: rgba(248,250,252,0.85);
  }
  .planeo-cant-box {
    display: inline-block;
    min-width: 32px;
    height: 9px;
    border-bottom: 1px solid rgba(248,250,252,0.85);
  }
  .planeo-hist {
    font-size: 8px;
    color: rgba(148,163,184,0.95);
  }

  .planeo-observacion {
    margin-top: 5px;
  }
  .planeo-observ-label {
    font-size: 8.5px;
    color: rgba(248,250,252,0.8);
    margin-bottom: 1px;
  }
  .planeo-observ-box {
    border-radius: 8px;
    border: 1px dashed rgba(148,163,184,0.9);
    height: 32px;
  }

  footer {
    margin-top: 8px;
    padding-top: 5px;
    border-top: 1px solid rgba(148,163,184,0.6);
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: rgba(148,163,184,0.9);
  }
</style>
</head>
<body>
  <div class="wrapper">
    <header class="header">
      <div class="logo-titulo">
        <div class="logo-small">SODASALE · BACKOFFICE</div>
        <h1>Reporte de Reparto & Cobranza por Zona</h1>
        <div class="subtitle">
          Elegí una zona, visualizá la deuda de tus clientes fiados
          y armá el plan de reparto con los productos a entregar.
        </div>
        <div class="filtros-box">
          ${filtrosTexto}
        </div>
      </div>
      <div class="meta">
        <div><strong>Emitido:</strong> ${ahora}</div>
        ${
          reparto?.nombre
            ? `<div><strong>Reparto ID:</strong> ${reparto.id}</div>`
            : ''
        }
      </div>
    </header>

    <section class="kpis">
      <div class="kpi-card">
        <div class="kpi-label">Clientes en zona</div>
        <div class="kpi-value">${resumen.total_clientes || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clientes con deuda</div>
        <div class="kpi-value">${resumen.total_clientes_con_deuda || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Deuda total zona</div>
        <div class="kpi-value">${moneyAR(resumen.deuda_total_zona || 0)}</div>
      </div>
    </section>

    <section>
      <div class="clientes-section-title">Detalle por cliente</div>
      ${
        clientesHtml ||
        '<div class="text-body">No hay clientes para el filtro seleccionado.</div>'
      }
    </section>

    <footer>
      <span>Módulo Reparto & CxC · SodaSale · SoftFusion</span>
      <span>Generado automáticamente</span>
    </footer>
  </div>
</body>
</html>`;
}


/* ============================================================
 * 4) Endpoint PDF
 * ============================================================ */

export const OBR_ReporteRepartoCobranzaPDF_CTS = async (req, res) => {
  try {
    const data = await obtenerReporteRepartoCobranzaDatos(req.query || {});
    const html = buildReporteRepartoCobranzaHtml(data);

    const browser = await puppeteer.launch({
      headless: 'new', // o true según tu versión
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '18mm', left: '10mm', right: '10mm' }
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="reporte-reparto-cobranza.pdf"'
    );
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('OBR_ReporteRepartoCobranzaPDF_CTS error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      code: err.code || 'SERVER_ERROR',
      mensajeError: 'No se pudo generar el PDF de reparto & cobranza.'
    });
  }
};
