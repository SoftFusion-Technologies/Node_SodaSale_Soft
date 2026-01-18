/*
 * Programador: Benjamin Orellana
 * Fecha Creación: 18 / 01 / 2026
 * Versión: 1.0
 *
 * Descripción:
 *  PDF "Reporte Simple" (modelo tipo Excel) para Reparto & Cobranza:
 *  - SOLO 2 columnas: CLIENTE | SALDO TOTAL
 *  - Sin detalle de ventas / sin productos / sin observaciones.
 *
 * Tema: Ventas / Cobranzas
 * Capa: Backend - Controllers/Repartos
 */

import axios from 'axios';

const moneyAR = (n) =>
  (Number(n) || 0).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  });

const escapeHtml = (s = '') =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const buildHtmlReporteSimple = ({ reporte }) => {
  const rows = Array.isArray(reporte?.clientes) ? reporte.clientes : [];

  const tableRows = rows
    .map((it) => {
      const nombre = it?.cliente?.nombre || '—';
      const saldo = Number(it?.deuda_total || 0);

      return `
        <tr>
          <td class="td td-left">${escapeHtml(nombre)}</td>
          <td class="td td-right">${escapeHtml(moneyAR(saldo))}</td>
        </tr>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte Simple - Reparto & Cobranza</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      margin: 0;
    }

    .sheet { width: 100%; }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }

    th, td {
      border: 2px solid #111827;
      padding: 6px 8px;
      font-size: 12px;
      line-height: 1.2;
      background: #ffffff;
      vertical-align: top;
    }

    th {
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .02em;
      text-align: left;

      /* FIX: evitar que "CLIENTE" se parta letra por letra */
      white-space: nowrap;
      word-break: normal;
      overflow-wrap: normal;
    }

    .td-left {
      text-align: left;
      word-break: normal;
      overflow-wrap: break-word; /* permite cortar por palabra si hace falta, no por letra */
    }

    .td-right {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    colgroup col:first-child { width: 68%; }
    colgroup col:last-child  { width: 32%; }
  </style>
</head>
<body>
  <div class="sheet">
    <table>
      <colgroup>
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>CLIENTE</th>
          <th>SALDO TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${
          tableRows ||
          `<tr><td class="td-left" colspan="2">Sin datos para los filtros seleccionados.</td></tr>`
        }
      </tbody>
    </table>
  </div>
</body>
</html>`;
};

export const exportReporteRepartoCobranzaSimplePDF = async (req, res) => {
  try {
    const { reparto_id, fecha_desde, fecha_hasta, solo_con_deuda } =
      req.query || {};

    if (!reparto_id) {
      return res.status(400).json({ mensajeError: 'Falta reparto_id' });
    }

    const API_URL = process.env.API_URL || 'http://localhost:8080';
    const authHeader = req.headers?.authorization;

    const resp = await axios.get(`${API_URL}/reportes/reparto-cobranza`, {
      params: {
        reparto_id,
        fecha_desde: fecha_desde || undefined,
        fecha_hasta: fecha_hasta || undefined,
        solo_con_deuda: solo_con_deuda || undefined
      },
      headers: authHeader ? { Authorization: authHeader } : undefined
    });

    const reporte = resp?.data || null;
    const html = buildHtmlReporteSimple({ reporte });
    const pdfBuffer = await renderHtmlToPdfBufferStandalone(html);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="reparto_cobranza_simple_${reparto_id}.pdf"`
    );
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error(
      '[PDF SIMPLE] Error exportReporteRepartoCobranzaSimplePDF:',
      err
    );
    return res.status(500).json({
      mensajeError: 'No se pudo generar el PDF simple. Intentá nuevamente.'
    });
  }
};

const renderHtmlToPdfBufferStandalone = async (html) => {
  const puppeteer = await import('puppeteer');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // FIX: viewport ancho para evitar reflow que rompe palabras por letra
    await page.setViewport({ width: 1280, height: 720 });

    await page.setContent(html, { waitUntil: 'networkidle0' });

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' }
    });
  } finally {
    await browser.close();
  }
};
