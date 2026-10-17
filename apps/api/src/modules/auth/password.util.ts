import * as bcrypt from 'bcryptjs';

/** Strong password hashing (bcrypt, cost factor 12 by default). */
export async function hashPassword(plain: string, rounds = 12): Promise<string> {
  return bcrypt.hash(plain, rounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
