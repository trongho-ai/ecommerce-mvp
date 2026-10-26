import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export function publicUser(user) {
  return { uid: user.uid, username: user.username, fullname: user.fullname, role: user.role, membership: user.membership };
}

export function authenticate(prisma, config) {
  return async (req, res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'UNAUTHENTICATED', 'A Bearer token is required.');
    let payload;
    try {
      payload = jwt.verify(match[1], config.JWT_SECRET, {
        algorithms: ['HS256'], issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE,
      });
      if (typeof payload !== 'object' || !/^\d+$/.test(payload.sub ?? '') || !Number.isSafeInteger(payload.exp)) throw new Error('Invalid claims');
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Token is invalid or expired.');
    }
    const uid = Number(payload.sub);
    if (!Number.isSafeInteger(uid) || uid < 1 || uid > 2147483647) throw new HttpError(401, 'INVALID_TOKEN', 'Invalid subject.');
    const user = await prisma.user.findUnique({ where: { uid }, include: { role: true, membership: true } });
    if (!user) throw new HttpError(401, 'INVALID_TOKEN', 'Account no longer exists.');
    req.user = user;
    req.actor = { uid: user.uid, role: user.role.rolename };
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.actor.role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Administrator access is required.');
  next();
}

export async function register(prisma, data) {
  const [role, membership] = await Promise.all([
    prisma.role.findUnique({ where: { rolename: 'normal' } }),
    prisma.membership.findUnique({ where: { mname: 'BASIC' } }),
  ]);
  if (!role || !membership || membership.score !== 10) throw new HttpError(503, 'SETUP_REQUIRED', 'Default role or membership is missing or misconfigured. Run the seed command.');
  const user = await prisma.user.create({
    data: { username: data.username, fullname: data.fullname, password: await bcrypt.hash(data.password, 12), roleid: role.roleid, mid: membership.mid },
    include: { role: true, membership: true },
  });
  return publicUser(user);
}

const dummyHash = bcrypt.hashSync('dummy-account-password-for-timing', 12);
export async function login(prisma, config, data) {
  const user = await prisma.user.findUnique({ where: { username: data.username }, include: { role: true, membership: true } });
  const valid = await bcrypt.compare(data.password, user?.password ?? dummyHash);
  if (!user || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  const accessToken = jwt.sign({}, config.JWT_SECRET, { algorithm: 'HS256', subject: String(user.uid),
    expiresIn: config.JWT_TTL_SECONDS, issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE });
  return { accessToken, tokenType: 'Bearer', expiresIn: config.JWT_TTL_SECONDS, user: publicUser(user) };
}
