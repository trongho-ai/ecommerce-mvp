import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const dbPassword = randomBytes(24).toString('hex');
const jwtSecret = randomBytes(48).toString('hex');
const adminPassword = randomBytes(18).toString('hex');
const contents = `NODE_ENV=development
PORT=3000
POSTGRES_USER=shop
POSTGRES_DB=shop
POSTGRES_PASSWORD=${dbPassword}
DATABASE_URL=postgresql://shop:${dbPassword}@localhost:5433/shop?schema=public
TEST_DATABASE_URL=postgresql://shop:${dbPassword}@localhost:5433/shop_test?schema=public
JWT_SECRET=${jwtSecret}
JWT_TTL_SECONDS=900
JWT_ISSUER=ecommerce-mvp
JWT_AUDIENCE=ecommerce-clients
AUTH_RATE_LIMIT=20
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${adminPassword}
`;
try {
  writeFileSync(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 });
  console.log('Created .env. Read admin credentials locally; do not share this file.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; kept existing values.');
  else throw error;
}
