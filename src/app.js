import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authenticate, requireAdmin, register, login, publicUser } from './auth.js';
import { HttpError, errorHandler } from './errors.js';
import { idSchema, registerSchema, loginSchema, productSchema, productPatchSchema, paginationSchema, orderSchema, shipmentSchema } from './validation.js';
import { createOrder, listOrders, getOrder } from './orders.js';
import { updateShipment } from './shipments.js';

export function createApp({ prisma, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health/live', (req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  const api = express.Router();
  const auth = authenticate(prisma, config);
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.AUTH_RATE_LIMIT,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } } });
  api.post('/auth/register', limiter, async (req, res) => {
    const user = await register(prisma, registerSchema.parse(req.body));
    res.status(201).location('/api/v1/users/me').json({ data: user });
  });
  api.post('/auth/login', limiter, async (req, res) => res.json({ data: await login(prisma, config, loginSchema.parse(req.body)) }));
  api.get('/users/me', auth, (req, res) => res.json({ data: publicUser(req.user) }));

  api.get('/products', async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const [data, total] = await Promise.all([
      prisma.product.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { pid: 'asc' } }), prisma.product.count(),
    ]);
    res.json({ data, pagination: { page, limit, total } });
  });
  api.get('/products/:pid', async (req, res) => {
    const product = await prisma.product.findUnique({ where: { pid: idSchema.parse(req.params.pid) } });
    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Product not found.');
    res.json({ data: product });
  });
  api.post('/products', auth, requireAdmin, async (req, res) => {
    const product = await prisma.product.create({ data: productSchema.parse(req.body) });
    res.status(201).location(`/api/v1/products/${product.pid}`).json({ data: product });
  });
  api.patch('/products/:pid', auth, requireAdmin, async (req, res) => {
    const product = await prisma.product.update({ where: { pid: idSchema.parse(req.params.pid) }, data: productPatchSchema.parse(req.body) });
    res.json({ data: product });
  });
  api.delete('/products/:pid', auth, requireAdmin, async (req, res) => {
    await prisma.product.delete({ where: { pid: idSchema.parse(req.params.pid) } });
    res.status(204).end();
  });
  api.post('/orders', auth, async (req, res) => {
    const data = await createOrder(prisma, req.actor.uid, orderSchema.parse(req.body).items);
    res.status(201).location(`/api/v1/orders/${data.oid}`).json({ data });
  });
  api.get('/orders', auth, async (req, res) => res.json(await listOrders(prisma, req.actor, paginationSchema.parse(req.query))));
  api.get('/orders/:oid', auth, async (req, res) => res.json({ data: await getOrder(prisma, req.actor, idSchema.parse(req.params.oid)) }));
  api.patch('/shipments/:shipid', auth, requireAdmin, async (req, res) => {
    const shipment = await updateShipment(prisma, idSchema.parse(req.params.shipid), shipmentSchema.parse(req.body).status);
    res.json({ data: shipment });
  });
  app.use('/api/v1', api);
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use(errorHandler(logger));
  return app;
}
