import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import { connectionRouter } from './routes/connection.js';
import { schemaRouter } from './routes/schema.js';
import { dataRouter } from './routes/data.js';
import { cqlRouter } from './routes/cql.js';
import { metadataRouter } from './routes/metadata.js';
import { errorHandler } from './middleware/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  // API
  app.use('/api/profiles', connectionRouter);
  app.use('/api/schema', schemaRouter);
  app.use('/api/data', dataRouter);
  app.use('/api/cql', cqlRouter);
  app.use('/api/metadata', metadataRouter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // SPA serving (production). The compiled client/dist is one level up
  // from server/dist when running `node dist/index.js`.
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use(errorHandler);

  return app;
}
