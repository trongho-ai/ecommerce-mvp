import { HttpError } from './errors.js';
import { SHIPMENT_STATUSES } from './domain.js';

const nextStatus = { PENDING: 'SHIPPED', SHIPPED: 'DELIVERED' };

// The route requires ADMIN before calling this service.
export async function updateShipment(prisma, shipid, status) {
  if (!SHIPMENT_STATUSES.includes(status)) {
    throw new HttpError(400, 'INVALID_STATUS', 'Shipment status must be PENDING, SHIPPED, or DELIVERED.');
  }

  return prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { shipid } });
    if (!shipment) {
      throw new HttpError(404, 'SHIPMENT_NOT_FOUND', 'Shipment was not found.');
    }
    // Repeating a successful PATCH has no extra side effects.
    if (shipment.status === status) return shipment;
    if (nextStatus[shipment.status] !== status) {
      throw new HttpError(409, 'INVALID_STATUS_TRANSITION', `Cannot change ${shipment.status} to ${status}.`);
    }

    const changed = await tx.shipment.updateMany({
      where: { shipid, status: shipment.status },
      data: { status },
    });
    if (changed.count !== 1) {
      throw new HttpError(409, 'SHIPMENT_CHANGED', 'Shipment changed concurrently. Reload and retry.');
    }
    return { ...shipment, status };
  });
}
