import { randomBytes, randomUUID } from 'node:crypto';

/** URL-safe random identifier used for order numbers. */
export function randomOrderSuffix(length = 6): string {
  return randomBytes(Math.ceil(length * 0.75)).toString('base64url').slice(0, length).toUpperCase();
}

export function newUuid(): string {
  return randomUUID();
}
