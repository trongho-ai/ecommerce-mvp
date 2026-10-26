import { HttpError } from './errors.js';
import { formatOrder } from './domain.js';

const orderInclude = {
  details: {
    orderBy: { pid: 'asc' },
    include: { product: { select: { pid: true, pname: true } } },
  },
  shipments: { orderBy: { shipid: 'asc' } },
};

function visibleOrders(actor) {
  return actor.role === 'ADMIN' ? {} : { uid: actor.uid };
}

export async function createOrder(prisma, uid, items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new HttpError(400, 'INVALID_ITEMS', 'Order must contain 1 to 50 items.');
  }
  const seen = new Set();
  for (const item of items) {
    if (!item || !Number.isInteger(item.pid) || item.pid < 1 || item.pid > 2147483647 || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 1000) {
      throw new HttpError(400, 'INVALID_ITEMS', 'Each item needs a positive pid and qty from 1 to 1000.');
    }
    if (seen.has(item.pid)) {
      throw new HttpError(400, 'DUPLICATE_PRODUCT', 'Each product may appear only once in an order.');
    }
    seen.add(item.pid);
  }

  const order = await prisma.$transaction(async (tx) => {
    const details = [];

    // A consistent lock order reduces deadlocks between multi-product orders.
    for (const item of [...items].sort((a, b) => a.pid - b.pid)) {
      // Checking and decreasing stock in the same UPDATE prevents overselling.
      const changed = await tx.product.updateMany({
        where: { pid: item.pid, quantity: { gte: item.qty } },
        data: { quantity: { decrement: item.qty } },
      });
      if (changed.count !== 1) {
        const exists = await tx.product.findUnique({ where: { pid: item.pid }, select: { pid: true } });
        if (!exists) {
          throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Product ${item.pid} was not found.`);
        }
        throw new HttpError(409, 'INSUFFICIENT_STOCK', `Product ${item.pid} has insufficient stock.`);
      }

      // The UPDATE holds the product row lock until commit; snapshot its price.
      // Client-supplied uid, unit_price, totals, and status are never used.
      const product = await tx.product.findUniqueOrThrow({
        where: { pid: item.pid },
        select: { price: true },
      });
      details.push({ pid: item.pid, qty: item.qty, unit_price: product.price });
    }

    return tx.order.create({
      data: {
        uid,
        details: { create: details },
        shipments: { create: { status: 'PENDING' } },
      },
      include: orderInclude,
    });
  }, { maxWait: 5000, timeout: 15000 });

  return formatOrder(order);
}

export async function getOrder(prisma, actor, oid) {
  // Include ownership in the query; other customers' order IDs also return 404.
  const order = await prisma.order.findFirst({
    where: { oid, ...visibleOrders(actor) },
    include: orderInclude,
  });
  if (!order) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
  }
  return formatOrder(order);
}

export async function listOrders(prisma, actor, { page = 1, limit = 20 } = {}) {
  const where = visibleOrders(actor);
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { oid: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
  return { data: orders.map(formatOrder), pagination: { page, limit, total } };
}
