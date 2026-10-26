import { z } from 'zod';

export const idSchema = z.coerce.number().int().positive().max(2147483647);
const password = z.string().min(12).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.');
export const registerSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  fullname: z.string().trim().min(1).max(100), password,
}).strict();
export const loginSchema = z.object({
  username: z.string().trim().min(3).max(50),
  password: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes.'),
}).strict();
const productFields = {
  pname: z.string().trim().min(1).max(100),
  price: z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, 'Price must be a nonnegative decimal string with at most 8 integer digits and 2 fractional digits.'),
  quantity: z.number().int().min(0).max(2147483647),
};
export const productSchema = z.object(productFields).strict();
export const productPatchSchema = z.object(productFields).partial().strict().refine(value => Object.keys(value).length > 0, 'Supply at least one field.');
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const orderSchema = z.object({ items: z.array(z.object({
  pid: z.number().int().positive().max(2147483647), qty: z.number().int().min(1).max(1000),
}).strict()).min(1).max(50) }).strict().refine(value => new Set(value.items.map(item => item.pid)).size === value.items.length, 'Duplicate product IDs are not allowed.');
export const shipmentSchema = z.object({ status: z.enum(['PENDING', 'SHIPPED', 'DELIVERED']) }).strict();
