/**
 * Unit tests for the email one-time code service.
 *
 * Focus: the security properties the OTP login relies on - codes are hashed at
 * rest, single use, short lived, attempt limited, resend rate limited, and
 * unknown addresses behave exactly like known ones (no enumeration).
 */
import { OtpService } from '../src/modules/otp/otp.service';
import { OtpPurpose } from '../src/database/entities/email-otp.entity';

const USER = { id: 'user-1', email: 'buyer@example.com', status: 'ACTIVE', emailVerified: false };

function build(options: { user?: unknown; existing?: unknown[] } = {}) {
  const stored: any[] = [...(options.existing ?? [])];
  const otpRepository = {
    create: jest.fn((value: any) => ({ id: 'otp-new', attempts: 0, consumedAt: null, ...value })),
    save: jest.fn(async (value: any) => {
      const index = stored.findIndex((item) => item.id === value.id);
      if (index >= 0) stored[index] = value;
      else stored.push(value);
      return value;
    }),
    update: jest.fn(async (criteria: any, patch: any) => {
      // `IsNull()` (used by the service) is a FindOperator, not a value.
      const consumedAtCriterion = criteria.consumedAt;
      const wantsNull =
        consumedAtCriterion === undefined ||
        consumedAtCriterion === null ||
        typeof consumedAtCriterion === 'object';

      for (const item of stored) {
        const matches =
          (criteria.email === undefined || item.email === criteria.email) &&
          (criteria.purpose === undefined || item.purpose === criteria.purpose) &&
          (wantsNull ? item.consumedAt == null : item.consumedAt === consumedAtCriterion);
        if (matches) Object.assign(item, patch);
      }
      return { affected: stored.length };
    }),
    findOne: jest.fn(async () => stored.filter((item) => item.consumedAt == null).pop() ?? null),
  };
  const userRepository = {
    findOneBy: jest.fn(async () => (options.user === undefined ? USER : options.user)),
  };
  const redis = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
  };
  const mail = {
    sendOtpCode: jest.fn(async () => ({ ok: true })),
  };
  const config = { get: jest.fn(() => 10) } as any;

  const service = new OtpService(otpRepository as any, userRepository as any, redis as any, mail as any, config);
  return { service, otpRepository, userRepository, redis, mail, stored };
}

/** Reads the plaintext code that was emailed (the only place it exists). */
function emailedCode(mail: { sendOtpCode: jest.Mock }): string {
  expect(mail.sendOtpCode).toHaveBeenCalled();
  return mail.sendOtpCode.mock.calls[0][1] as string;
}

describe('OtpService', () => {
  it('emails a 6-digit code and stores only a hash', async () => {
    const ctx = build();
    const result = await ctx.service.request('buyer@example.com', 'LOGIN', '127.0.0.1');

    expect(result).toEqual({ sent: true });
    const code = emailedCode(ctx.mail);
    expect(code).toMatch(/^\d{6}$/);
    expect(ctx.stored).toHaveLength(1);
    expect(ctx.stored[0].codeHash).not.toContain(code);
    expect(ctx.stored[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('normalises the email address (case + whitespace)', async () => {
    const ctx = build();
    await ctx.service.request('  Buyer@Example.COM ', 'LOGIN');
    expect(ctx.userRepository.findOneBy).toHaveBeenCalledWith({ email: 'buyer@example.com' });
  });

  it('does not store or send anything for an unknown address', async () => {
    const ctx = build({ user: null });
    const result = await ctx.service.request('nobody@example.com', 'LOGIN');

    expect(result).toEqual({ sent: true }); // identical observable behaviour
    expect(ctx.mail.sendOtpCode).not.toHaveBeenCalled();
    expect(ctx.otpRepository.save).not.toHaveBeenCalled();
  });

  it('refuses a second code within the cooldown window', async () => {
    const ctx = build();
    (ctx.redis.get as any) = jest.fn(async () => '1');
    await expect(ctx.service.request('buyer@example.com', 'LOGIN')).rejects.toThrow(/wait a minute/i);
    expect(ctx.mail.sendOtpCode).not.toHaveBeenCalled();
  });

  it('invalidates previous codes when a new one is requested', async () => {
    const existing = {
      id: 'old',
      email: 'buyer@example.com',
      purpose: 'LOGIN' as OtpPurpose,
      attempts: 0,
      consumedAt: null,
    };
    const ctx = build({ existing: [existing] });
    await ctx.service.request('buyer@example.com', 'LOGIN');

    expect(ctx.otpRepository.update).toHaveBeenCalled();
    expect(existing.consumedAt).toBeInstanceOf(Date);
  });

  it('verifies a correct code and consumes it (single use)', async () => {
    const ctx = build();
    await ctx.service.request('buyer@example.com', 'LOGIN');
    const code = emailedCode(ctx.mail);

    const otp = await ctx.service.verify('buyer@example.com', code, 'LOGIN');
    expect(otp.consumedAt).toBeInstanceOf(Date);

    // Second use fails: no active code remains.
    await expect(ctx.service.verify('buyer@example.com', code, 'LOGIN')).rejects.toThrow(/invalid or expired/i);
  });

  it('rejects a wrong code but keeps the attempt counter', async () => {
    const ctx = build();
    await ctx.service.request('buyer@example.com', 'LOGIN');
    emailedCode(ctx.mail);

    await expect(ctx.service.verify('buyer@example.com', '000000', 'LOGIN')).rejects.toThrow(/invalid code/i);
    expect(ctx.stored[0].attempts).toBe(1);
  });

  it('locks the code after 5 failed attempts', async () => {
    const ctx = build();
    await ctx.service.request('buyer@example.com', 'LOGIN');
    emailedCode(ctx.mail);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(ctx.service.verify('buyer@example.com', '111111', 'LOGIN')).rejects.toThrow();
    }
    await expect(ctx.service.verify('buyer@example.com', '111111', 'LOGIN')).rejects.toThrow(/too many attempts/i);
  });

  it('rejects an expired code', async () => {
    const ctx = build();
    await ctx.service.request('buyer@example.com', 'LOGIN');
    const code = emailedCode(ctx.mail);
    ctx.stored[0].expiresAt = new Date(Date.now() - 1000);

    await expect(ctx.service.verify('buyer@example.com', code, 'LOGIN')).rejects.toThrow(/expired/i);
  });

  it('refuses to re-verify an already verified address', async () => {
    const ctx = build({ user: { ...USER, emailVerified: true } });
    await expect(ctx.service.request('buyer@example.com', 'EMAIL_VERIFICATION')).rejects.toThrow(/already verified/i);
  });
});
