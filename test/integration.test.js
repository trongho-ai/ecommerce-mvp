// Requires a real migrated PostgreSQL database dedicated to testing.
// TEST_DATABASE_URL must point to a database whose name ends in _test.
// Cleanup deletes only this test's own UUID-labelled fixtures; no reset/truncate.
import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { createOrder, getOrder } from '../src/orders.js';
import { updateShipment } from '../src/shipments.js';

test('PostgreSQL: order invariants, concurrency, ownership and shipment transitions', async (t) => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to a separate migrated database ending in _test.');
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  assert.match(parsed.protocol, /^postgres(ql)?:$/, 'Use a PostgreSQL TCP connection URL.');
  assert.match(databaseName, /^[A-Za-z0-9_]+_test$/, 'Integration database name must end in _test.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({
    connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  }) });
  const prefix = `test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const userIds = [];
  const productIds = [];

  t.after(async () => {
    try {
      if (userIds.length) {
        const orders = await prisma.order.findMany({
          where: { uid: { in: userIds } }, select: { oid: true },
        });
        const orderIds = orders.map(({ oid }) => oid);
        await prisma.shipment.deleteMany({ where: { oid: { in: orderIds } } });
        await prisma.orderDetail.deleteMany({ where: { oid: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { oid: { in: orderIds } } });
        await prisma.user.deleteMany({ where: { uid: { in: userIds } } });
      }
      if (productIds.length) await prisma.product.deleteMany({ where: { pid: { in: productIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const role = await prisma.role.upsert({
    where: { rolename: 'normal' }, update: {}, create: { rolename: 'normal' },
  });
  const membership = await prisma.membership.upsert({
    where: { mname: 'BASIC' }, update: {}, create: { mname: 'BASIC', score: 10 },
  });
  const passwordHash = await bcrypt.hash('integration-fixture-password', 4);
  async function user(suffix) {
    const result = await prisma.user.create({ data: {
      username: `${prefix}_${suffix}`, fullname: 'Integration Test User',
      password: passwordHash, roleid: role.roleid, mid: membership.mid,
    } });
    userIds.push(result.uid);
    return result;
  }
  async function product(suffix, quantity, price = '12.34') {
    const result = await prisma.product.create({ data: {
      pname: `${prefix}_${suffix}`, price, quantity,
    } });
    productIds.push(result.pid);
    return result;
  }
  const alice = await user('alice');
  const bob = await user('bob');
  const aliceActor = { uid: alice.uid, role: 'normal' };
  const bobActor = { uid: bob.uid, role: 'normal' };

  await t.test('two concurrent orders cannot purchase the last unit twice', async () => {
    const last = await product('last_unit', 1);
    const results = await Promise.allSettled([
      createOrder(prisma, alice.uid, [{ pid: last.pid, qty: 1 }]),
      createOrder(prisma, bob.uid, [{ pid: last.pid, qty: 1 }]),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    const rejected = results.find(({ status }) => status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    const stored = await prisma.product.findUniqueOrThrow({ where: { pid: last.pid } });
    assert.equal(stored.quantity, 0);
    assert.equal(await prisma.orderDetail.count({ where: { pid: last.pid } }), 1);
  });

  await t.test('an unavailable second item rolls back all stock changes and the order', async () => {
    const available = await product('rollback_available', 5);
    const unavailable = await product('rollback_empty', 0);
    const before = await prisma.order.count({ where: { uid: alice.uid } });
    await assert.rejects(createOrder(prisma, alice.uid, [
      { pid: available.pid, qty: 2 }, { pid: unavailable.pid, qty: 1 },
    ]), { status: 409 });
    const stored = await prisma.product.findUniqueOrThrow({ where: { pid: available.pid } });
    assert.equal(stored.quantity, 5);
    assert.equal(await prisma.order.count({ where: { uid: alice.uid } }), before);
    assert.equal(await prisma.orderDetail.count({ where: { pid: available.pid } }), 0);
  });

  await t.test('the purchased price remains unchanged after the catalogue price changes', async () => {
    const item = await product('snapshot', 4, '0.10');
    const order = await createOrder(prisma, alice.uid, [{ pid: item.pid, qty: 3 }]);
    assert.equal(order.details[0].unit_price, '0.10');
    assert.equal(order.total, '0.30');
    await prisma.product.update({ where: { pid: item.pid }, data: { price: '99.99' } });
    const reloaded = await getOrder(prisma, aliceActor, order.oid);
    assert.equal(reloaded.details[0].unit_price, '0.10');
    assert.equal(reloaded.total, '0.30');
  });

  await t.test('customers cannot read another customer order; an admin can', async () => {
    const item = await product('ownership', 1);
    const order = await createOrder(prisma, alice.uid, [{ pid: item.pid, qty: 1 }]);
    await assert.rejects(getOrder(prisma, bobActor, order.oid), { status: 404 });
    assert.equal((await getOrder(prisma, aliceActor, order.oid)).oid, order.oid);
    assert.equal((await getOrder(prisma, { uid: bob.uid, role: 'ADMIN' }, order.oid)).oid, order.oid);
  });

  await t.test('shipment status cannot skip or reverse its permitted steps', async () => {
    const item = await product('shipping', 1);
    const order = await createOrder(prisma, alice.uid, [{ pid: item.pid, qty: 1 }]);
    assert.equal(order.shipments.length, 1);
    const { shipid } = order.shipments[0];
    assert.equal(order.shipments[0].status, 'PENDING');
    await assert.rejects(updateShipment(prisma, shipid, 'DELIVERED'), { status: 409 });
    assert.equal((await updateShipment(prisma, shipid, 'SHIPPED')).status, 'SHIPPED');
    assert.equal((await updateShipment(prisma, shipid, 'SHIPPED')).status, 'SHIPPED');
    assert.equal((await updateShipment(prisma, shipid, 'DELIVERED')).status, 'DELIVERED');
    await assert.rejects(updateShipment(prisma, shipid, 'PENDING'), { status: 409 });
  });

  await t.test('database constraints reject negative stock even outside the API', async () => {
    const item = await product('constraint', 1);
    await assert.rejects(prisma.product.update({
      where: { pid: item.pid }, data: { quantity: -1 },
    }));
    const stored = await prisma.product.findUniqueOrThrow({ where: { pid: item.pid } });
    assert.equal(stored.quantity, 1);
  });
});
