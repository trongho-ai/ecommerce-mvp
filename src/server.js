import { config } from './config.js';
import { prisma } from './prisma.js';
import { createApp } from './app.js';

const app = createApp({ prisma, config });
const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`API listening on port ${config.PORT}`));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(async () => {
    await prisma.$disconnect();
    clearTimeout(timer);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
