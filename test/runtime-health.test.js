// Real HTTP and PostgreSQL driver failure path; no database methods are mocked.
// This deliberately disconnected probe does not verify a healthy database.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { createApp } from '../src/app.js';

test('real driver failure keeps liveness 200 and returns bounded readiness 503', { timeout: 12000 }, async (t) => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({
    connectionString: 'postgresql://health_probe:do_not_echo_credentials@127.0.0.1:1/unavailable',
    max: 10,
    connectionTimeoutMillis: 2000,
    query_timeout: 2500,
    statement_timeout: 2500,
  }) });
  const config = {
    NODE_ENV: 'test', PORT: 3000,
    JWT_SECRET: 'a'.repeat(64), JWT_TTL_SECONDS: 900,
    JWT_ISSUER: 'ecommerce-mvp', JWT_AUDIENCE: 'ecommerce-clients',
    AUTH_RATE_LIMIT: 1000,
  };
  const logger = { error() {}, warn() {}, info() {}, log() {} };
  const server = createApp({ prisma, config, logger }).listen(0, '127.0.0.1');
  t.after(async () => {
    try {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    } finally {
      await prisma.$disconnect();
    }
  });
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const live = await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(5000) });
  assert.equal(live.status, 200);
  assert.equal((await live.json()).status, 'ok');

  const started = performance.now();
  const ready = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(5000) });
  const body = await ready.text();
  const elapsed = performance.now() - started;
  assert.equal(ready.status, 503);
  assert.equal(JSON.parse(body).status, 'not_ready');
  assert.ok(elapsed < 5000, `Readiness must respond in under 5 seconds; observed ${Math.round(elapsed)} ms.`);
  assert.doesNotMatch(body, /health_probe|do_not_echo_credentials|postgresql|ECONNREFUSED/);

  const stillLive = await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(5000) });
  assert.equal(stillLive.status, 200);
  assert.equal((await stillLive.json()).status, 'ok');
});
