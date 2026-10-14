import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';

const config = loadConfig();
const database = await createDatabase(config.DATABASE_URL);
await database.migrate();
console.log(`migrations applied (${database.kind})`);
await database.close();
