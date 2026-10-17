import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { EmailOtp, OtpPurpose } from '../../database/entities/email-otp.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { hashPassword, verifyPassword } from '../auth/password.util';

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Minimum seconds between two codes for the same email + purpose. */
const RESEND_COOLDOWN_SECONDS = 60;
const COOLDOWN_KEY = 'otp:cooldown:';

/**
 * Email one-time codes.
 *
 * Used for:
 *  - passwordless login (LOGIN) - the code IS the second factor,
 *  - email ownership verification (EMAIL_VERIFICATION).
 *
 * Security properties:
 *  - the code is never persisted in plain text (bcrypt hash only),
 *  - single use, short lived (10 min), max 5 verification attempts,
 *  - resend is rate limited to one code per minute per email,
 *  - requesting a code for an unknown address behaves exactly like a known
 *    one (no user enumeration) - nothing is sent and nothing is stored.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(EmailOtp)
    private readonly otpRepository: Repository<EmailOtp>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  get expiresInMinutes(): number {
    return CODE_TTL_MINUTES;
  }

  /**
   * Issues and emails a code. Always resolves the same way, whether or not the
   * address exists, so the endpoint cannot be used to enumerate accounts.
   */
  async request(email: string, purpose: OtpPurpose, ip?: string): Promise<{ sent: true }> {
    const normalised = email.trim().toLowerCase();

    const cooldownKey = `${COOLDOWN_KEY}${purpose}:${normalised}`;
    if ((await this.redis.get(cooldownKey)) !== null) {
      throw new HttpException(
        'A code was already sent - please wait a minute before requesting another one',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.userRepository.findOneBy({ email: normalised });
    if (!user) {
      // Same observable behaviour as the success path.
      this.logger.debug(`OTP requested for unknown address (${purpose}) - nothing sent`);
      return { sent: true };
    }

    if (purpose === 'EMAIL_VERIFICATION' && user.emailVerified) {
      throw new HttpException('This email address is already verified', HttpStatus.BAD_REQUEST);
    }

    // Invalidate any previous live code for this address + purpose.
    // NOTE: `consumedAt: undefined` would be silently dropped by TypeORM, so
    // IsNull() is required - otherwise consumed codes stay in the candidate set.
    await this.otpRepository.update(
      { email: normalised, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
    const otp = this.otpRepository.create({
      email: normalised,
      purpose,
      codeHash: await hashPassword(code, 10),
      attempts: 0,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      consumedAt: null,
      ip: ip ?? null,
    });
    // save(create()) - not insert() - so the UUID listener runs.
    await this.otpRepository.save(otp);

    await this.redis.set(cooldownKey, '1', RESEND_COOLDOWN_SECONDS);

    await this.mail.sendOtpCode(normalised, code, CODE_TTL_MINUTES, purpose);
    this.logger.log(`OTP code sent to ${normalised} (${purpose})`);
    return { sent: true };
  }

  /** Verifies and consumes a code. Throws UnauthorizedException on any problem. */
  async verify(email: string, code: string, purpose: OtpPurpose): Promise<EmailOtp> {
    const normalised = email.trim().toLowerCase();

    const otp = await this.otpRepository.findOne({
      where: { email: normalised, purpose, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!otp) {
      // Covers "never requested", "already used" and "superseded by a newer code"
      // with one indistinguishable answer.
      throw new HttpException('Invalid or expired code - request a new one', HttpStatus.UNAUTHORIZED);
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new HttpException('Code expired - request a new one', HttpStatus.GONE);
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new HttpException('Too many attempts - request a new code', HttpStatus.TOO_MANY_REQUESTS);
    }

    otp.attempts += 1;
    await this.otpRepository.save(otp);

    const valid = await verifyPassword(code, otp.codeHash);
    if (!valid) {
      throw new HttpException('Invalid code', HttpStatus.UNAUTHORIZED);
    }

    otp.consumedAt = new Date();
    await this.otpRepository.save(otp);
    return otp;
  }

  /** Marks the address as verified (EMAIL_VERIFICATION flow). */
  async markEmailVerified(email: string): Promise<void> {
    await this.otpRepository.manager.transaction(async (manager) => {
      const user = await manager.findOneBy(User, { email: email.trim().toLowerCase() });
      if (!user || user.emailVerified) return;
      await manager.update(User, { id: user.id }, { emailVerified: true, emailVerifiedAt: new Date() });
      this.logger.log(`Email verified for ${user.email}`);
    });
  }

  /** Housekeeping: drop codes that expired more than a day ago. */
  async cleanupExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const result = await this.otpRepository
      .createQueryBuilder()
      .delete()
      .where('"expires_at" < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  get security(): { ttlMinutes: number; maxAttempts: number; cooldownSeconds: number } {
    return {
      ttlMinutes: this.config.get<number>('app.otp.ttlMinutes') ?? CODE_TTL_MINUTES,
      maxAttempts: MAX_ATTEMPTS,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }
}
