import dotenv from 'dotenv';
dotenv.config();

export const timeConfig = {
  toleranceMs: parseInt(process.env.TIME_TOLERANCE_MS ?? '60000', 10),
  maxOfflineMs: parseInt(process.env.TIME_MAX_OFFLINE_MS ?? '1800000', 10),
  guardMode: process.env.TIME_GUARD_MODE ?? 'observe',
  attestationSecret: process.env.TIME_ATTESTATION_SECRET || null,
  attestationTtlSec: parseInt(process.env.TIME_ATTESTATION_TTL_SEC ?? '60', 10),

  timeSource: (process.env.TIME_SOURCE || 'system').toLowerCase(), // 'ntp' o 'https'
  ntpHost: process.env.NTP_HOST || 'pool.ntp.org',
  ntpSyncMs: parseInt(process.env.NTP_SYNC_MS ?? '60000', 10)
};
