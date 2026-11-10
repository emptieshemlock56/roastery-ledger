// Stops a staging server from running on the production database, and the reverse.
// The first deployed server to start on a database marks it with its environment;
// after that, a server from any other environment refuses to start on it.

export class WrongDatabaseError extends Error {}

export async function claimEnvironment(db, appEnv) {
  await db.query('INSERT INTO app_environment (env) VALUES ($1) ON CONFLICT (id) DO NOTHING', [appEnv]);
  const { rows } = await db.query('SELECT env FROM app_environment');
  const owner = rows[0].env;
  if (owner !== appEnv) {
    throw new WrongDatabaseError(
      `This database belongs to "${owner}", but this server is "${appEnv}". ` +
        `Check this service's DATABASE_URL: it is probably the ${owner} database's link. Refusing to start.`,
    );
  }
  return owner;
}
