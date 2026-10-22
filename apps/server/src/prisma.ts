import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** JSON columns are stored as strings — central (de)serialization helpers. */
export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
