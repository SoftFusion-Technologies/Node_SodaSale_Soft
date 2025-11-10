// Routes/time.routes.js
import { Router } from 'express';
import crypto from 'node:crypto';
import { timeConfig } from '../config/time.config.js';
import { nowMs, getOffsetMs, getSource, refreshNow } from '../Utils/authoritativeTime.js';

export const timeRouter = Router();

function buildServerTimePayload() {
  const serverUnixMs = nowMs();
  const payload = {
    serverUnixMs,
    toleranceMs: timeConfig.toleranceMs,
    maxOfflineMs: timeConfig.maxOfflineMs
  };

  if (timeConfig.attestationSecret) {
    const exp = Math.floor(serverUnixMs / 1000) + timeConfig.attestationTtlSec;
    const toSign = `${serverUnixMs}.${exp}`;
    const sig = crypto.createHmac('sha256', timeConfig.attestationSecret)
      .update(toSign).digest('base64url');
    payload.attestation = `${toSign}.${sig}`;
  }
  return payload;
}

// Routes/time.routes.js
timeRouter.get('/time', async (req, res) => {
  try {
    const force = req.query.refresh === '1'; // 👈 solo query param
    if (force) await refreshNow();

    const data = buildServerTimePayload();

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });

    // DESCOMENTAR PARA SEGUIMIENTO
    // console.log(JSON.stringify({
    //   msg: 'time_endpoint_hit',
    //   forceRefresh: !!force,
    //   timeSource: getSource?.(),
    //   ntpOffsetMs: getOffsetMs?.(),
    //   serverUnixMs: data.serverUnixMs
    // }));

    return res.status(200).json(data);
  } catch (e) {
    console.error(JSON.stringify({ msg: 'time_endpoint_error', err: e?.message }));
    if (!res.headersSent) return res.status(500).json({ error: 'time_endpoint_failed' });
  }
});


timeRouter.get('/time/debug', (req, res) => {
  const localNow = Date.now();
  const authNow = nowMs();
  res.json({
    timeSource: timeConfig.timeSource,
    ntpOffsetMs: getOffsetMs?.() ?? null,
    localNowMs: localNow,
    authoritativeNowMs: authNow,
    deltaMs_local_minus_auth: localNow - authNow
  });
});