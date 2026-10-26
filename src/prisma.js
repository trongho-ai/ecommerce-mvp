import { PrismaClient } from './generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config.js';

const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  query_timeout: 2500,
  statement_timeout: 2500,
});
export const prisma = new PrismaClient({ adapter });
