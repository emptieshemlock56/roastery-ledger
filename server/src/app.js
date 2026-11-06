import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter, requireAppHeader, requireAuth } from './auth.js';
import { createEventHub } from './events.js';
import { errorHandler } from './http.js';
import importRouter from './routes/import.js';
import itemsRouter from './routes/items.js';
import machinesRouter from './routes/machines.js';
import movementsRouter from './routes/movements.js';
import reportsRouter from './routes/reports.js';
import stockRouter from './routes/stock.js';
import usersRouter, { auditRouter } from './routes/users.js';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createApp({ db, config }) {
  const app = express();
  const events = createEventHub();
  const ctx = { db, config, events };

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, env: config.appEnv, version: config.version });
  });

  app.use('/api', requireAppHeader);
  app.get('/api/config', (_req, res) => res.json({ env: config.appEnv, version: config.version }));
  app.use('/api/auth', authRouter(ctx));

  app.use('/api', requireAuth(ctx));
  app.get('/api/events', events.handler);
  app.use('/api/items', itemsRouter(ctx));
  app.use('/api/machines', machinesRouter(ctx));
  app.use('/api/movements', movementsRouter(ctx));
  app.use('/api/stock', stockRouter(ctx));
  app.use('/api/reports', reportsRouter(ctx));
  app.use('/api/import', importRouter(ctx));
  app.use('/api/users', usersRouter(ctx));
  app.use('/api/audit', auditRouter(ctx));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In staging/production the built React app is served by this same server.
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return { app, events };
}
