import { z } from 'zod';
import { SHIPMENT_STATUSES } from '@jixin/shared';

const trimmed = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
export const sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{64}$/, 'Must be a 64-character SHA-256 hex digest');

const phoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[+\d][\d\s-]+$/, 'Invalid phone number');

const addressSchema = z
  .object({
    province: trimmed(1, 30),
    city: trimmed(1, 30),
    district: trimmed(1, 50).optional(),
    detail: trimmed(2, 120),
    contactName: trimmed(1, 40),
    contactPhone: phoneSchema,
  })
  .strict();

const goodsSchema = z
  .object({
    name: trimmed(1, 80),
    category: trimmed(1, 40),
    quantity: z.coerce.number().int().min(1).max(100_000),
    weightKg: z.coerce.number().positive().max(1_000_000),
    description: trimmed(1, 300).optional(),
  })
  .strict();

const temperatureRangeSchema = z
  .object({
    min: z.coerce.number().min(-100).max(100),
    max: z.coerce.number().min(-100).max(100),
    unit: z.literal('C').default('C'),
  })
  .strict()
  .refine((range) => range.min < range.max, {
    message: 'Temperature minimum must be lower than maximum',
    path: ['max'],
  });

export const loginSchema = z
  .object({
    username: trimmed(1, 40),
    password: z.string().min(1).max(128),
  })
  .strict();

export const createShipmentSchema = z
  .object({
    origin: addressSchema,
    destination: addressSchema,
    goods: goodsSchema,
    expectedDeliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date must use YYYY-MM-DD')
      .refine(
        (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
        'Expected date is invalid',
      ),
    temperatureRange: temperatureRangeSchema.optional(),
    documentHash: sha256Schema.optional(),
  })
  .strict();

const optionalDescription = trimmed(1, 300).optional();
const requiredLocation = trimmed(1, 120);

export const acceptActionSchema = z
  .object({ location: requiredLocation.optional(), description: optionalDescription })
  .strict();
export const pickupActionSchema = z
  .object({
    location: requiredLocation,
    description: optionalDescription,
    evidenceHash: sha256Schema.optional(),
  })
  .strict();
export const checkpointActionSchema = z
  .object({
    location: requiredLocation,
    description: trimmed(1, 300),
    temperature: z.coerce.number().min(-100).max(100).optional(),
    evidenceHash: sha256Schema.optional(),
  })
  .strict();
export const exceptionActionSchema = z
  .object({
    location: requiredLocation,
    description: trimmed(2, 300),
    evidenceHash: sha256Schema.optional(),
  })
  .strict();
export const resolveActionSchema = exceptionActionSchema;
export const deliverActionSchema = z
  .object({
    location: requiredLocation,
    description: optionalDescription,
    evidenceHash: sha256Schema,
  })
  .strict();
export const confirmActionSchema = z
  .object({
    deliveryCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Delivery code must contain 6 digits'),
    location: requiredLocation.optional(),
    description: optionalDescription,
  })
  .strict();
export const cancelActionSchema = z.object({ reason: trimmed(1, 300).optional() }).strict();

export const shipmentIdParamsSchema = z.object({ id: trimmed(1, 100) }).strict();
export const trackingParamsSchema = z.object({ trackingNumber: trimmed(4, 100) }).strict();
export const listShipmentsQuerySchema = z
  .object({
    status: z.enum(SHIPMENT_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export const verifySchema = z
  .object({
    trackingNumber: trimmed(4, 100),
    evidenceHash: sha256Schema.optional(),
  })
  .strict();

export type CreateShipmentBody = z.infer<typeof createShipmentSchema>;
export type AcceptActionBody = z.infer<typeof acceptActionSchema>;
export type PickupActionBody = z.infer<typeof pickupActionSchema>;
export type CheckpointActionBody = z.infer<typeof checkpointActionSchema>;
export type ExceptionActionBody = z.infer<typeof exceptionActionSchema>;
export type DeliverActionBody = z.infer<typeof deliverActionSchema>;
export type ConfirmActionBody = z.infer<typeof confirmActionSchema>;
