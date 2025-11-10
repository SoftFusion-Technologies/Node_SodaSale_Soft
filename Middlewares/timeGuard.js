// Middlewares/timeGuard.js
import { timeConfig } from '../config/time.config.js';
import { nowMs } from '../Utils/authoritativeTime.js';

/**
 * timeGuard: defensa en profundidad contra manipulación de reloj del cliente.
 * - NO requiere headers del cliente. Actúa solo si se envían (opcional).
 * - Verifica skew entre "tiempo reportado por el cliente" y hora del servidor.
 * - Modos: observe | soft | strict
 *
 * Headers opcionales que el frontend podría enviar:
 *   - x-client-reported-time: ms epoch reportados por el cliente (Number)
 *   - x-time-guard-reason: texto opcional de motivo desde el cliente
 *
 * Recomendación para futuros devs: aplicar este middleware SOLO a endpoints sensibles (ventas, caja, stock).
 */
export function timeGuard(protectedPrefixes = []) {
  const mode = (timeConfig.guardMode || 'observe').toLowerCase();
  const tolerance = Number(timeConfig.toleranceMs || 60000);
  const requireHeader =
    String(process.env.TIME_REQUIRE_CLIENT_TIME || 'false').toLowerCase() ===
    'true';

  return function (req, res, next) {
    if (protectedPrefixes.length) {
      const hitProtected = protectedPrefixes.some((p) =>
        req.path.startsWith(p)
      );
      if (!hitProtected) return next();
    }

    const clientReportedRaw = req.headers['x-client-reported-time'];
    const clientReason = req.headers['x-time-guard-reason'] || undefined;

    const serverNowMs = nowMs(); // ✅ autoridad (no Date.now)
    let skewMs = null;
    let action = 'allow';

    if (
      requireHeader &&
      mode !== 'observe' &&
      clientReportedRaw === undefined
    ) {
      console.log(
        JSON.stringify({
          msg: 'time_guard_missing_header',
          mode,
          path: req.path,
          method: req.method
        })
      );
      return res.status(428).json({
        codigo: 'TIME_HEADER_REQUIRED',
        mensaje:
          'Se requiere la hora reportada del cliente (x-client-reported-time).',
        detalles: { toleranceMs: tolerance }
      });
    }

    if (clientReportedRaw !== undefined) {
      const clientMs = Number(clientReportedRaw);
      if (!Number.isNaN(clientMs)) {
        skewMs = serverNowMs - clientMs;
        const absSkew = Math.abs(skewMs);
        if (absSkew > tolerance) {
          action = mode === 'observe' ? 'observe' : 'block';
        }
      }
    }

    console.log(
      JSON.stringify({
        msg: 'time_guard_check',
        mode,
        path: req.path,
        method: req.method,
        skewMs,
        toleranceMs: tolerance,
        action,
        ip: req.ip,
        ua: req.headers['user-agent']
      })
    );

    if (action === 'block') {
      return res.status(428).json({
        codigo: 'TIME_SKEW_EXCEEDED',
        mensaje:
          'La hora del dispositivo no coincide con la hora oficial. Ajuste la fecha/hora y reintente.',
        detalles: { toleranceMs: tolerance, skewMs }
      });
    }

    res.locals.serverNowMs = serverNowMs;
    return next();
  };
}