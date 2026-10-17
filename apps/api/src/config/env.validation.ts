/**
 * Fail-fast validation of critical environment variables.
 * Imported by ConfigModule.forRoot({ validate }) - runs before anything else.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const required = ['DATABASE_URL', 'REDIS_URL'];
  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV === 'production') {
    const secrets = ['ENCRYPTION_KEY', 'JWT_SECRET'];
    const missingSecrets = secrets.filter((key) => !config[key]);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required secrets for production: ${missingSecrets.join(', ')}`);
    }
    for (const key of secrets) {
      if (String(config[key]).length < 32) {
        throw new Error(`${key} must be at least 32 characters long in production.`);
      }
    }
  }

  return config;
}
