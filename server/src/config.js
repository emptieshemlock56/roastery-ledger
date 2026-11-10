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
    // Two-factor sign-in is required for everyone in staging and production, optional
    // in dev (so local sandboxes stay simple). REQUIRE_2FA=true/false overrides.
    require2fa: env.REQUIRE_2FA ? env.REQUIRE_2FA === 'true' : deployed,
    // Shown in authenticator apps, so staging and production codes can't be confused.
    totpIssuer: appEnv === 'production' ? 'Roastery Ledger' : `Roastery Ledger (${appEnv})`,
    version: (env.RENDER_GIT_COMMIT || env.GIT_SHA || 'local').slice(0, 7),
    databaseUrl: env.DATABASE_URL || null,
    databaseSsl: env.DATABASE_SSL === 'true',
    // Local dev keeps its embedded database in server/.data/dev-db (relative to the
    // server folder, where `npm run dev` runs). Tests pass their own config and use
    // an in-memory database. Set here rather than in package.json so it works on Windows.
    pgliteDir: env.PGLITE_DIR ?? (appEnv === 'dev' && !env.DATABASE_URL ? './.data/dev-db' : null),
    // Sign-in help requests are emailed here (and always listed on the Users page).
    helpRequestEmail: env.HELP_REQUEST_EMAIL || null,
    // This site's address, for links in emails. Render sets RENDER_EXTERNAL_URL itself.
    publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || null,
    resendApiKey: env.RESEND_API_KEY || null,
    mailFrom: env.MAIL_FROM || 'Roastery Ledger <onboarding@resend.dev>',
    adminEmail: env.ADMIN_EMAIL || null,
    adminPassword: env.ADMIN_PASSWORD || null,
  };
}
