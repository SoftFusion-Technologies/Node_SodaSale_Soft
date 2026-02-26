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

// ======================================================
// Benjamin Orellana - 25-02-2026
// FIX TZ: evitar que fechas "date-only" (YYYY-MM-DD) resten 1 día por parse UTC.
// Parseamos manualmente a Date local (new Date(y, m-1, d)).
// Soporta:
// - Date
// - "YYYY-MM-DD"
// - "DD/MM/YYYY"
// - ISO datetime (se deja new Date para mantener hora real)
// ======================================================
const formatFechaDMY = (input) => {
  if (!input) return '—';

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '—';
    const dd = String(input.getDate()).padStart(2, '0');
    const mm = String(input.getMonth() + 1).padStart(2, '0');
    const yyyy = String(input.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  const s = String(input).trim();
  if (!s) return '—';

  // YYYY-MM-DD (date-only) => parse local (sin TZ shift)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yy, mm, dd] = s.split('-').map((x) => Number(x));
    const d = new Date(yy, (mm || 1) - 1, dd || 1);
    const outDD = String(d.getDate()).padStart(2, '0');
    const outMM = String(d.getMonth() + 1).padStart(2, '0');
    const outYY = String(d.getFullYear());
    return `${outDD}/${outMM}/${outYY}`;
  }

  // DD/MM/YYYY => parse local
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yy] = s.split('/').map((x) => Number(x));
    const d = new Date(yy, (mm || 1) - 1, dd || 1);
    const outDD = String(d.getDate()).padStart(2, '0');
    const outMM = String(d.getMonth() + 1).padStart(2, '0');
    const outYY = String(d.getFullYear());
    return `${outDD}/${outMM}/${outYY}`;
  }

  // ISO datetime u otros formatos => dejamos Date normal
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) {
    const dd = String(d1.getDate()).padStart(2, '0');
    const mm = String(d1.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d1.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
};

// ======================================================
// Benjamin Orellana - 25-02-2026
// Helper: rango de fechas para encabezado del PDF
// ======================================================
const buildRangoFechas = ({ fecha_desde, fecha_hasta }) => {
  const d = formatFechaDMY(fecha_desde);
  const h = formatFechaDMY(fecha_hasta);

  // Si no hay ninguna
  if ((d === '—' || !fecha_desde) && (h === '—' || !fecha_hasta)) {
    return 'Todo el período';
  }

  // Si viene una sola
  if (fecha_desde && (!fecha_hasta || h === '—')) return `Desde ${d}`;
  if (fecha_hasta && (!fecha_desde || d === '—')) return `Hasta ${h}`;

  return `${d} al ${h}`;
};

const buildHtmlReporteSimple = ({ reporte, meta }) => {
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

  // ======================================================
  // Benjamin Orellana - 25-02-2026
  // Encabezado: reparto + rango de fechas (con fallbacks seguros)
  // ======================================================
  const repartoLabel =
    meta?.reparto_label ||
    reporte?.reparto?.nombre ||
    reporte?.reparto_nombre ||
    (meta?.reparto_id ? `Reparto ${meta.reparto_id}` : 'Reparto');

  const rangoFechas = buildRangoFechas({
    fecha_desde: meta?.fecha_desde,
    fecha_hasta: meta?.fecha_hasta
  });

  const soloConDeuda = String(meta?.solo_con_deuda || '').trim();
  const showSoloConDeuda =
    soloConDeuda === '1' || soloConDeuda === 'true' || soloConDeuda === 'TRUE';

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

    /* Benjamin Orellana - 25-02-2026 - Encabezado superior del PDF (reparto + rango fechas) */
    .meta {
      width: 100%;
      margin-bottom: 10px;
      border: 2px solid #111827;
      padding: 8px 10px;
      box-sizing: border-box;
    }

    .meta-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .meta-left {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 72%;
    }

    .meta-right {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .02em;
      white-space: nowrap;
      text-align: right;
      max-width: 28%;
    }

    .meta-sub {
      margin-top: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11px;
      color: #111827;
    }

    .chip {
      display: inline-block;
      border: 2px solid #111827;
      padding: 2px 8px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .02em;
      white-space: nowrap;
    }

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

    <!-- Benjamin Orellana - 25-02-2026 - Encabezado requerido: reparto + rango de fechas -->
    <div class="meta">
      <div class="meta-row">
        <div class="meta-left">${escapeHtml(repartoLabel)}</div>
        <div class="meta-right">${escapeHtml(rangoFechas)}</div>
      </div>
      <div class="meta-sub">
        <div>Reporte Simple - Reparto & Cobranza</div>
        ${
          showSoloConDeuda
            ? `<div class="chip">Solo con deuda</div>`
            : `<div class="chip">Incluye saldados</div>`
        }
      </div>
    </div>

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

    // ======================================================
    // Benjamin Orellana - 25-02-2026
    // Meta para encabezado del PDF:
    // - reparto_label: intenta tomarlo del reporte si viene, si no usa fallback "Reparto {id}"
    // - rango de fechas: se muestra en el encabezado (dd/mm/yyyy)
    // ======================================================
    const meta = {
      reparto_id: reparto_id,
      fecha_desde: fecha_desde || null,
      fecha_hasta: fecha_hasta || null,
      solo_con_deuda: solo_con_deuda || null,
      reparto_label:
        reporte?.reparto?.nombre ||
        reporte?.reparto_nombre ||
        reporte?.zona_nombre ||
        null
    };

    const html = buildHtmlReporteSimple({ reporte, meta });
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
