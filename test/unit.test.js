import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';

const config = {
  NODE_ENV: 'test', PORT: 3000,
  JWT_SECRET: 'a'.repeat(64), JWT_TTL_SECONDS: 900,
  JWT_ISSUER: 'ecommerce-mvp', JWT_AUDIENCE: 'ecommerce-clients',
  AUTH_RATE_LIMIT: 1000,
};
const logger = { error() {}, warn() {}, info() {}, log() {} };
const customer = {
  uid: 7, username: 'test_customer', fullname: 'Test Customer',
  password: 'HASH_MUST_NEVER_BE_RETURNED', roleid: 2, mid: 1,
  role: { roleid: 2, rolename: 'normal' },
  membership: { mid: 1, mname: 'BASIC', score: 10 },
};
const appWith = (prisma = {}, overrides = {}) => createApp({
  prisma, config: { ...config, ...overrides }, logger,
});
const token = (options = {}, payload = {}) => jwt.sign(payload, config.JWT_SECRET, {
  algorithm: 'HS256', subject: String(customer.uid), expiresIn: 900,
  issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, ...options,
});

test('malformed environment configuration fails without disclosing its secret value', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import('./src/config.js')"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: {
      ...process.env, NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://private-user:credential_to_keep_private@',
      JWT_SECRET: config.JWT_SECRET,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /credential_to_keep_private|private-user/);
});

test('liveness remains 200 without querying the database', async () => {
  const app = appWith({ $queryRaw: () => { throw new Error('must not query'); } });
  const response = await request(app).get('/health/live').expect(200);
  assert.equal(response.body.status, 'ok');
});

test('readiness is 200 when the database probe succeeds', async () => {
  let probes = 0;
  const app = appWith({ $queryRaw: async () => { probes += 1; return [{ value: 1 }]; } });
  const response = await request(app).get('/health/ready').expect(200);
  assert.equal(response.body.status, 'ready');
  assert.equal(probes, 1);
});

test('readiness returns 503 without leaking database credentials, then recovers', async () => {
  let available = false;
  const app = appWith({ $queryRaw: async () => {
    if (!available) throw new Error('postgresql://private-user:private-password@private-host/db');
    return [{ value: 1 }];
  } });
  const down = await request(app).get('/health/ready').expect(503);
  assert.equal(down.body.status, 'not_ready');
  assert.doesNotMatch(JSON.stringify(down.body), /private-password|private-host|postgresql/);
  await request(app).get('/health/live').expect(200);
  available = true;
  const recovered = await request(app).get('/health/ready').expect(200);
  assert.equal(recovered.body.status, 'ready');
});

test('register rejects roleid instead of allowing privilege escalation', async () => {
  let writes = 0;
  const app = appWith({ user: { create: async () => { writes += 1; } } });
  await request(app).post('/api/v1/auth/register').send({
    username: 'new_customer', fullname: 'New Customer',
    password: 'a-long-enough-password', roleid: 1,
  }).expect(400);
  assert.equal(writes, 0);
});

test('register assigns normal/BASIC on the server and returns no password hash', async () => {
  let stored;
  const role = { roleid: 42, rolename: 'normal' };
  const membership = { mid: 31, mname: 'BASIC', score: 10 };
  const app = appWith({
    role: { findUnique: async ({ where }) => { assert.equal(where.rolename, 'normal'); return role; } },
    membership: { findUnique: async ({ where }) => { assert.equal(where.mname, 'BASIC'); return membership; } },
    user: {
      findUnique: async () => null,
      create: async ({ data }) => {
        stored = data;
        return { uid: 8, ...data, role, membership };
      },
    },
  });
  const response = await request(app).post('/api/v1/auth/register').send({
    username: 'new_customer', fullname: 'New Customer', password: 'a-long-enough-password',
  }).expect(201);
  assert.equal(stored.roleid, role.roleid);
  assert.equal(stored.mid, membership.mid);
  assert.equal(response.body.data.role.rolename, 'normal');
  assert.equal(response.body.data.membership.score, 10);
  assert.notEqual(stored.password, 'a-long-enough-password');
  assert.equal(await bcrypt.compare('a-long-enough-password', stored.password), true);
  assert.doesNotMatch(JSON.stringify(response.body), /password|\$2[aby]\$/);
});

test('register requires reseeding when the shared BASIC score is misconfigured', async () => {
  let writes = 0;
  const app = appWith({
    role: { findUnique: async () => ({ roleid: 2, rolename: 'normal' }) },
    membership: { findUnique: async () => ({ mid: 1, mname: 'BASIC', score: 0 }) },
    user: { create: async () => { writes += 1; } },
  });
  const response = await request(app).post('/api/v1/auth/register').send({
    username: 'needs_setup', fullname: 'Needs Setup', password: 'a-long-enough-password',
  }).expect(503);
  assert.equal(response.body.error.code, 'SETUP_REQUIRED');
  assert.equal(writes, 0);
});

test('register rejects a password exceeding bcrypt limit in UTF-8 bytes', async () => {
  await request(appWith()).post('/api/v1/auth/register').send({
    username: 'new_customer', fullname: 'New Customer', password: 'ệ'.repeat(25),
  }).expect(400);
});

test('product writes require authentication', async () => {
  await request(appWith()).post('/api/v1/products').send({
    pname: 'Demo', price: '10.00', quantity: 3,
  }).expect(401);
});

test('an authenticated customer cannot edit products', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  await request(app).patch('/api/v1/products/1')
    .set('Authorization', `Bearer ${token()}`)
    .send({ price: '1.00' }).expect(403);
});

test('an ADMIN token claim cannot override the role currently stored in the database', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  await request(app).post('/api/v1/products')
    .set('Authorization', `Bearer ${token({}, { role: 'ADMIN' })}`)
    .send({ pname: 'Demo', price: '10.00', quantity: 1 }).expect(403);
});

test('a customer cannot update a shipment status', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  await request(app).patch('/api/v1/shipments/1')
    .set('Authorization', `Bearer ${token()}`)
    .send({ status: 'SHIPPED' }).expect(403);
});

for (const [description, options] of [
  ['expired', { expiresIn: -1 }],
  ['wrong audience', { audience: 'another-application' }],
  ['wrong issuer', { issuer: 'another-issuer' }],
  ['unapproved signing algorithm', { algorithm: 'HS384' }],
]) {
  test(`authentication rejects a token with ${description}`, async () => {
    let reads = 0;
    const app = appWith({ user: { findUnique: async () => { reads += 1; return customer; } } });
    await request(app).get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token(options)}`).expect(401);
    assert.equal(reads, 0, 'invalid JWT must fail before user lookup');
  });
}

test('a token for a deleted user is rejected', async () => {
  const app = appWith({ user: { findUnique: async () => null } });
  await request(app).get('/api/v1/users/me')
    .set('Authorization', `Bearer ${token()}`).expect(401);
});

test('the profile response never exposes the stored password hash', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  const response = await request(app).get('/api/v1/users/me')
    .set('Authorization', `Bearer ${token()}`).expect(200);
  assert.equal(response.body.data.uid, customer.uid);
  assert.doesNotMatch(JSON.stringify(response.body), /password|HASH_MUST_NEVER_BE_RETURNED/);
});

test('login returns a verifiable short-lived JWT and excludes the password hash', async () => {
  const hash = await bcrypt.hash('a-long-enough-password', 4);
  const app = appWith({ user: { findUnique: async () => ({ ...customer, password: hash }) } });
  const response = await request(app).post('/api/v1/auth/login').send({
    username: customer.username, password: 'a-long-enough-password',
  }).expect(200);
  const data = response.body.data;
  assert.equal(data.tokenType, 'Bearer');
  assert.equal(data.expiresIn, config.JWT_TTL_SECONDS);
  const claims = jwt.verify(data.accessToken, config.JWT_SECRET, {
    algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE,
  });
  assert.equal(claims.sub, String(customer.uid));
  assert.equal(claims.exp - claims.iat, config.JWT_TTL_SECONDS);
  assert.doesNotMatch(JSON.stringify(response.body), /password|\$2[aby]\$/);
});

test('login returns 401 for a wrong password', async () => {
  const hash = await bcrypt.hash('a-long-enough-password', 4);
  const app = appWith({ user: { findUnique: async () => ({ ...customer, password: hash }) } });
  await request(app).post('/api/v1/auth/login').send({
    username: customer.username, password: 'an-incorrect-password',
  }).expect(401);
});

test('login rejects a password over 72 UTF-8 bytes before checking its truncated prefix', async () => {
  let reads = 0;
  const app = appWith({ user: { findUnique: async () => { reads += 1; return customer; } } });
  await request(app).post('/api/v1/auth/login').send({
    username: customer.username, password: `${'a'.repeat(72)}extra`,
  }).expect(400);
  assert.equal(reads, 0);
});

test('authentication attempts are rate limited', async () => {
  const app = appWith({}, { AUTH_RATE_LIMIT: 1 });
  await request(app).post('/api/v1/auth/login').send({}).expect(400);
  await request(app).post('/api/v1/auth/login').send({}).expect(429);
});

test('order creation rejects a client supplied price before touching stock', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  await request(app).post('/api/v1/orders')
    .set('Authorization', `Bearer ${token()}`)
    .send({ items: [{ pid: 1, qty: 1, unit_price: '0.01' }] }).expect(400);
});

test('order creation rejects duplicate products before starting a transaction', async () => {
  const app = appWith({ user: { findUnique: async () => customer } });
  await request(app).post('/api/v1/orders')
    .set('Authorization', `Bearer ${token()}`)
    .send({ items: [{ pid: 1, qty: 1 }, { pid: 1, qty: 2 }] }).expect(400);
});
