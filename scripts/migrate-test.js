import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const connection = process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a separate database ending in _test.');
}
const result = spawnSync(process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL: connection } });
process.exit(result.status ?? 1);
