// All runtime configuration comes from environment variables.
// APP_ENV is one of: dev, test, staging, production.

const DEPLOYED = new Set(['staging', 'production']);

export function loadConfig(env = process.env) {
  const appEnv = env.APP_ENV || 'dev';
  const deployed = DEPLOYED.has(appEnv);

  if (deployed && !env.JWT_SECRET) throw new Error('JWT_SECRET must be set in staging/production');
  if (deployed && !env.DATABASE_URL) throw new Error('DATABASE_URL must be set in staging/production');

  return {
    appEnv,
    deployed,
    port: Number(env.PORT || 3001),
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-do-not-use-elsewhere',
    secureCookies: deployed,
    bcryptRounds: appEnv === 'test' ? 4 : 12,
    version: (env.RENDER_GIT_COMMIT || env.GIT_SHA || 'local').slice(0, 7),
    databaseUrl: env.DATABASE_URL || null,
    databaseSsl: env.DATABASE_SSL === 'true',
    // Local dev keeps its embedded database here. Unset = in-memory (tests).
    pgliteDir: env.PGLITE_DIR ?? null,
    adminEmail: env.ADMIN_EMAIL || null,
    adminPassword: env.ADMIN_PASSWORD || null,
  };
}
