// ./Utils/authoritativeTime.js
import { timeConfig } from '../config/time.config.js';

// (Opcional) NTP: se intentará si está instalado; si no, se ignora sin romper
let Sntp = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  Sntp = await import('@hapi/sntp'); // Node 18 ESM admite import dinámico
} catch {
  /* sin NTP, seguimos con HTTPS */
}

let offsetMs = 0; // authoritativeNow - Date.now()
let lastSyncOk = 0;
let source = 'system'; // 'ntp' | 'https' | 'system'

async function refreshWithNtp() {
  if (!Sntp) throw new Error('sntp_not_installed');
  const t = await Sntp.time({
    host: timeConfig.ntpHost || 'pool.ntp.org',
    timeout: 1200
  });
  offsetMs = Number(t.offset || 0);
  lastSyncOk = Date.now();
  source = 'ntp';
  console.log(JSON.stringify({ msg: 'ntp_sync_ok', offsetMs, lastSyncOk }));
}

async function refreshWithHttps() {
  // Cualquier servidor serio devuelve header Date, usamos Google que suele estar cerca
  const r = await fetch('https://www.google.com', { method: 'HEAD' });
  const dateHdr = r.headers.get('date');
  if (!dateHdr) throw new Error('no_date_header');
  const serverMs = new Date(dateHdr).getTime();
  offsetMs = serverMs - Date.now();
  lastSyncOk = Date.now();
  source = 'https';
  console.log(
    JSON.stringify({ msg: 'https_time_sync_ok', offsetMs, lastSyncOk })
  );
}

async function refreshOffset() {
  const mode = (timeConfig.timeSource || 'system').toLowerCase();

  // Orden: 1) si pedís ntp, probá ntp y si falla cae a https
  //        2) si pedís https, andá directo a https
  //        3) system => sin offset
  if (mode === 'ntp') {
    try {
      await refreshWithNtp();
      return;
    } catch (e) {
      console.error(
        JSON.stringify({ msg: 'ntp_sync_failed', error: e.message })
      );
      try {
        await refreshWithHttps();
        return;
      } catch (e2) {
        console.error(
          JSON.stringify({ msg: 'https_fallback_failed', error: e2.message })
        );
      }
    }
  } else if (mode === 'https') {
    try {
      await refreshWithHttps();
      return;
    } catch (e) {
      console.error(
        JSON.stringify({ msg: 'https_time_sync_failed', error: e.message })
      );
    }
  }

  // Si nada funcionó ⇒ sistema local (no recomendado)
  source = 'system';
  offsetMs = 0;
  lastSyncOk = 0;
  console.warn(JSON.stringify({ msg: 'time_source_system_fallback' }));
}

export async function initAuthoritativeTime() {
  await refreshOffset();
  const period = Math.max(15000, Number(timeConfig.ntpSyncMs || 60000));
  setInterval(refreshOffset, period);
}

export function nowMs() {
  // ⚠️ SIEMPRE devolvemos Date.now() + offset, sin importar el source.
  // Si source === 'system', offsetMs = 0 ⇒ es Date.now().
  return Date.now() + offsetMs;
}

export function getOffsetMs() {
  return offsetMs;
}
export function getLastSyncOk() {
  return lastSyncOk;
}
export function getSource() {
  return source;
}

// al final del archivo
let _refreshing = false;

export async function refreshNow() {
  if (_refreshing) return; // evita solapados
  _refreshing = true;
  try {
    await refreshOffset(); // reutiliza tu función interna
  } finally {
    _refreshing = false;
  }
}
