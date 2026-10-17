/**
 * Centralised, validated application configuration.
 * All environment variables are parsed here exactly once and injected as
 * a typed object - nothing else in the codebase reads process.env directly.
 */
import { registerAs } from '@nestjs/config';

function requiredInProduction(name: string, value: string | undefined): string {
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const configuration = registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  const encryptionKey = requiredInProduction('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY);
  const jwtSecret = requiredInProduction('JWT_SECRET', process.env.JWT_SECRET);

  if (nodeEnv === 'production') {
    if (encryptionKey.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters long.');
    }
    if (jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long.');
    }
  }

  let marzbanInbounds: Record<string, string[]> = {};
  try {
    marzbanInbounds = JSON.parse(process.env.MARZBAN_DEFAULT_INBOUNDS ?? '{}');
  } catch {
    marzbanInbounds = {};
  }

  return {
    env: nodeEnv,
    isProduction: nodeEnv === 'production',
    port: int(process.env.APP_PORT, 4000),
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    corsOrigins: (process.env.CORS_ORIGINS ?? process.env.APP_URL ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: bool(process.env.TRUST_PROXY, true),
    swaggerEnabled: bool(process.env.SWAGGER_ENABLED, false),

    db: {
      url: process.env.DATABASE_URL ?? '',
      sync: bool(process.env.DB_SYNC, false),
    },

    redis: {
      url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    },

    security: {
      encryptionKey: encryptionKey || 'dev-only-insecure-encryption-key-32chars',
      jwtSecret: jwtSecret || 'dev-only-insecure-jwt-secret-32-chars-long',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      jwtRefreshExpiresIn: int(process.env.JWT_REFRESH_EXPIRES_IN, 604800),
      bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),
      cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    },

    throttle: {
      ttl: int(process.env.THROTTLE_TTL, 60),
      limit: int(process.env.THROTTLE_LIMIT, 120),
      authLimit: int(process.env.AUTH_THROTTLE_LIMIT, 10),
    },

    seed: {
      enabled: bool(process.env.SEED_SUPER_ADMIN, false),
      email: process.env.SUPER_ADMIN_EMAIL ?? 'admin@example.com',
      password: process.env.SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!',
    },

    bayargg: {
      baseUrl: process.env.BAYARGG_BASE_URL ?? 'https://www.bayar.gg/api',
      checkoutUrl: process.env.BAYARGG_CHECKOUT_URL ?? 'https://www.bayar.gg/pay',
      paymentMethod: process.env.BAYARGG_PAYMENT_METHOD ?? 'qris_bayar_gg',
      // Optional first-boot fallback. Runtime values live encrypted in the DB
      // and are managed from the Admin Panel.
      fallbackApiKey: process.env.BAYARGG_API_KEY ?? '',
      fallbackWebhookSecret: process.env.BAYARGG_WEBHOOK_SECRET ?? '',
    },

    resend: {
      baseUrl: process.env.RESEND_BASE_URL ?? 'https://api.resend.com',
      fromEmail: process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com',
      fallbackApiKey: process.env.RESEND_API_KEY ?? '',
    },

    marzban: {
      defaultInbounds: marzbanInbounds,
      statusCheckIntervalMinutes: int(process.env.MARZBAN_STATUS_CHECK_INTERVAL, 5),
      requestTimeoutMs: int(process.env.MARZBAN_REQUEST_TIMEOUT, 15000),
    },
  };
});
