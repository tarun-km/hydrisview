import { loadConfig } from '../config';
import { createDatabase } from '../db/client';
import { demoEmail, DEMO_USERS, seedDemo, seedPlatformAdmin } from './demo';

const config = loadConfig();
const database = await createDatabase(config.DATABASE_URL);
await database.migrate();

if (!config.SEED_ADMIN_EMAIL || !config.SEED_ADMIN_PASSWORD || config.SEED_ADMIN_PASSWORD.length < 12) {
  throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) in .env');
}
const admin = await seedPlatformAdmin(database.db, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD);
console.log(admin.created ? `platform admin created: ${config.SEED_ADMIN_EMAIL}` : 'platform admin already exists');

if (process.argv.includes('--demo')) {
  if (!config.SEED_DEMO_PASSWORD || config.SEED_DEMO_PASSWORD.length < 12) throw new Error('Set SEED_DEMO_PASSWORD (12+ characters) in .env');
  await seedDemo(database.db, config.SEED_DEMO_PASSWORD);
  console.log('demo tenant ready. Users (password = SEED_DEMO_PASSWORD):');
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(22)} ${demoEmail(u.key)}`);
}
await database.close();
