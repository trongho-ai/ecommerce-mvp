import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !/^[A-Za-z0-9_]{3,50}$/.test(username) || !password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set ADMIN_USERNAME (3-50 letters, digits, underscores) and ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes) before seeding.');
  }

  const adminRole = await prisma.role.upsert({
    where: { rolename: 'ADMIN' },
    update: {},
    create: { rolename: 'ADMIN' },
  });
  await prisma.role.upsert({
    where: { rolename: 'normal' },
    update: {},
    create: { rolename: 'normal' },
  });
  const basic = await prisma.membership.upsert({
    where: { mname: 'BASIC' },
    // Score belongs to this shared membership tier, as in the database diagram.
    update: { score: 10 },
    create: { mname: 'BASIC', score: 10 },
  });

  const existingAdmin = await prisma.user.findUnique({ where: { username } });
  if (existingAdmin && existingAdmin.roleid !== adminRole.roleid) {
    throw new Error('ADMIN_USERNAME belongs to a customer; choose another name. Seed will not promote an existing customer.');
  }
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        username,
        fullname: 'MVP Administrator',
        password: await bcrypt.hash(password, 12),
        roleid: adminRole.roleid,
        mid: basic.mid,
      },
    });
  }

  // Let PostgreSQL allocate IDs so its autoincrement sequence remains correct.
  // Run seed once at a time; this script is not a concurrent production job.
  for (const product of [
    { pname: 'Ban phim co', price: '350000.00', quantity: 20 },
    { pname: 'Chuot khong day', price: '200000.00', quantity: 30 },
  ]) {
    const exists = await prisma.product.findFirst({ where: { pname: product.pname }, select: { pid: true } });
    if (!exists) await prisma.product.create({ data: product });
  }
  console.log('Seed complete: ADMIN/normal roles, BASIC score 10, administrator, sample products. Existing passwords and stock were preserved.');
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
