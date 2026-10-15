import { loadConfig } from '../config';
import { createDatabase } from './client';

const config = loadConfig();
const database = await createDatabase(config.DATABASE_URL);
await database.migrate();
console.log(`migrations applied (${database.kind})`);
await database.close();
