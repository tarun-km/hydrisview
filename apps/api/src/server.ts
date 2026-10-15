import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { startJobs } from './jobs';

const config = loadConfig();
const database = await createDatabase(config.DATABASE_URL);
await database.migrate();
const { app, ctx } = await buildApp({ db: database.db, config, logger: true });
const stopJobs = startJobs(ctx);

const shutdown = async () => {
  stopJobs();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.API_PORT, host: config.HOST });
