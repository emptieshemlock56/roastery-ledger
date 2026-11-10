import { createApp } from './app.js';
import { bootstrapAdmin } from './auth.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { claimEnvironment, WrongDatabaseError } from './envlock.js';
import { migrate } from './migrate.js';
import { seedDev } from './seed.js';

const config = loadConfig();
const db = await createDb(config);
console.log(`Database: ${db.engine}${db.engine === 'pglite' ? ` (${config.pgliteDir || 'in-memory'})` : ''}`);

const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

if (config.deployed) {
  try {
    console.log(`Database belongs to: ${await claimEnvironment(db, config.appEnv)}`);
  } catch (err) {
    if (!(err instanceof WrongDatabaseError)) throw err;
    console.error(`\n*** ${err.message}\n`);
    await db.close();
    process.exit(1);
  }
}

await bootstrapAdmin(db, config);
if (config.appEnv === 'dev' && process.env.SEED !== 'false') await seedDev(db, config);

const { app, events } = createApp({ db, config });
const server = app.listen(config.port, () => {
  console.log(`Roastery Ledger [${config.appEnv}] listening on http://localhost:${config.port}`);
});

async function shutdown() {
  events.closeAll();
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
