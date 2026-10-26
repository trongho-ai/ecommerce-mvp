// Run against the locally running Docker API after seeding. Uses .env privately.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/prisma.js';

const base = process.env.API_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}/api/v1`;
const suffix = randomBytes(8).toString('hex');
const username = `smoke_${suffix}`;
const password = randomBytes(18).toString('hex');
let customerId;
let productId;
let orderId;

async function call(method, path, expectedStatus, body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, expectedStatus, `${method} ${path}: unexpected HTTP status`);
  const result = response.status === 204 ? null : await response.json();
  // Do not print response bodies, passwords or tokens.
  console.log(`${method} ${path}: ${response.status}`);
  return result;
}

try {
  assert.ok(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD, 'Seed admin and configure ADMIN_USERNAME / ADMIN_PASSWORD first.');
  const admin = await call('POST', '/auth/login', 200, { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  const adminToken = admin.data.accessToken;
  const created = await call('POST', '/auth/register', 201, { username, fullname: 'Smoke test customer', password });
  customerId = created.data.uid;
  assert.equal(created.data.role.rolename, 'normal');
  assert.equal(created.data.membership.score, 10);
  assert.equal('password' in created.data, false);
  const login = await call('POST', '/auth/login', 200, { username, password });
  const token = login.data.accessToken;
  await call('GET', '/users/me', 200, undefined, token);
  await call('GET', '/users/me', 401);
  await call('POST', '/products', 403, { pname: 'Forbidden', price: '1.00', quantity: 1 }, token);
  const product = await call('POST', '/products', 201, { pname: `Smoke ${suffix}`, price: '0.10', quantity: 3 }, adminToken);
  productId = product.data.pid;
  const order = await call('POST', '/orders', 201, { items: [{ pid: productId, qty: 2 }] }, token);
  orderId = order.data.oid;
  assert.equal(order.data.total, '0.20');
  assert.equal(order.data.shipments[0].status, 'PENDING');
  await call('POST', '/orders', 409, { items: [{ pid: productId, qty: 2 }] }, token);
  await call('PATCH', `/products/${productId}`, 200, { price: '9.99' }, adminToken);
  const saved = await call('GET', `/orders/${orderId}`, 200, undefined, token);
  assert.equal(saved.data.total, '0.20');
  assert.equal(saved.data.details[0].unit_price, '0.10');
  const shippingId = order.data.shipments[0].shipid;
  await call('PATCH', `/shipments/${shippingId}`, 409, { status: 'DELIVERED' }, adminToken);
  await call('PATCH', `/shipments/${shippingId}`, 200, { status: 'SHIPPED' }, adminToken);
  await call('PATCH', `/shipments/${shippingId}`, 200, { status: 'DELIVERED' }, adminToken);
  await call('DELETE', `/products/${productId}`, 409, undefined, adminToken);
  console.log('Smoke checks passed. Cleaning only the fixtures created by this run.');
} finally {
  try {
    // Resolve owned fixtures even if a response was interrupted after DB commit.
    const fixtureUser = await prisma.user.findUnique({ where: { username }, select: { uid: true } });
    customerId ??= fixtureUser?.uid;
    const fixtureProducts = await prisma.product.findMany({ where: { pname: `Smoke ${suffix}` }, select: { pid: true } });
    const productIds = fixtureProducts.map(item => item.pid);
    if (customerId) {
      const orders = await prisma.order.findMany({ where: { uid: customerId }, select: { oid: true } });
      const orderIds = orders.map(order => order.oid);
      await prisma.shipment.deleteMany({ where: { oid: { in: orderIds } } });
      await prisma.orderDetail.deleteMany({ where: { oid: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { oid: { in: orderIds } } });
      await prisma.user.deleteMany({ where: { uid: customerId } });
    }
    if (productIds.length) await prisma.product.deleteMany({ where: { pid: { in: productIds } } });
  } finally {
    await prisma.$disconnect();
  }
}
