import { Prisma } from './generated/prisma/client.ts';

export const SHIPMENT_STATUSES = Object.freeze(['PENDING', 'SHIPPED', 'DELIVERED']);

// Return money as decimal strings rather than imprecise JSON floating points.
export function formatOrder(order) {
  let total = new Prisma.Decimal(0);
  const details = order.details.map((detail) => {
    const lineTotal = new Prisma.Decimal(detail.unit_price).mul(detail.qty);
    total = total.add(lineTotal);
    return {
      oid: detail.oid,
      pid: detail.pid,
      qty: detail.qty,
      unit_price: new Prisma.Decimal(detail.unit_price).toFixed(2),
      line_total: lineTotal.toFixed(2),
      ...(detail.product ? { product: detail.product } : {}),
    };
  });

  return {
    oid: order.oid,
    uid: order.uid,
    createat: order.createat,
    details,
    shipments: order.shipments ?? [],
    total: total.toFixed(2),
  };
}
