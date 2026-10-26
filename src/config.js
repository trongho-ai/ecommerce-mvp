import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine(value => {
    try { return ['postgres:', 'postgresql:'].includes(new URL(value).protocol); }
    catch { return false; }
  }),
  JWT_SECRET: z.string().min(64),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  JWT_ISSUER: z.string().min(1).default('ecommerce-mvp'),
  JWT_AUDIENCE: z.string().min(1).default('ecommerce-clients'),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print names only so secrets cannot appear in validation logs.
  throw new Error(`Invalid environment variables: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
}
export const config = parsed.data;
