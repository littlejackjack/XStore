import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { RegisterDto } from './dto/auth.dto';
import { hashPassword, verifyPassword } from './password.util';
import { sha256 } from '../../common/utils/crypto.util';
import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';

export interface TokenPair {
  accessToken: string;
  /** Refresh token is only ever returned to set an httpOnly cookie. */
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: User; tokens: TokenPair }> {
    const user = this.userRepository.create({
      email: dto.email.toLowerCase(),
      name: dto.name.trim(),
      passwordHash: await hashPassword(dto.password, this.config.get('app.security.bcryptRounds')),
      role: 'USER',
      status: 'ACTIVE',
    });
    const saved = await this.userRepository.save(user);
    const tokens = await this.issueTokens(saved);
    const { passwordHash: _ignored, ...safeUser } = saved;
    void _ignored;
    return { user: safeUser as User, tokens };
  }

  async login(email: string, password: string): Promise<{ user: User; tokens: TokenPair }> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();

    // Identical response for unknown email & wrong password (no user enumeration).
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) throw invalid;
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is suspended');

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw invalid;

    const tokens = await this.issueTokens(user);
    const { passwordHash: _ignored, ...safeUser } = user;
    void _ignored;
    return { user: safeUser as User, tokens };
  }

  /**
   * Passwordless login: the emailed one-time code IS the credential.
   * The code is verified (and consumed) before any token is issued.
   */
  async loginWithOtp(email: string, code: string): Promise<{ user: User; tokens: TokenPair }> {
    const normalised = email.trim().toLowerCase();
    await this.otp.verify(normalised, code, 'LOGIN');

    const user = await this.userRepository.findOneBy({ email: normalised });
    if (!user) throw new UnauthorizedException('Invalid email or code');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account is suspended');

    const tokens = await this.issueTokens(user);
    const { passwordHash: _ignored, ...safeUser } = user;
    void _ignored;
    return { user: safeUser as User, tokens };
  }

  /** Emails a one-time code (used by the auth controller). */
  async requestOtp(email: string, purpose: 'LOGIN' | 'EMAIL_VERIFICATION', ip?: string) {
    return this.otp.request(email, purpose, ip);
  }

  /** Confirms ownership of an email address with a one-time code. */
  async verifyEmailWithOtp(email: string, code: string): Promise<{ verified: true }> {
    const normalised = email.trim().toLowerCase();
    await this.otp.verify(normalised, code, 'EMAIL_VERIFICATION');
    await this.otp.markEmailVerified(normalised);
    return { verified: true };
  }

  /** Rotates the refresh token: the old one is revoked, a new pair is issued. */
  async refresh(refreshToken: string): Promise<{ user: User; tokens: TokenPair }> {
    const tokenHash = sha256(refreshToken);
    const stored = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    // Rotation: revoke the presented token before issuing a new one.
    await this.refreshTokenRepository.update({ id: stored.id }, { revokedAt: new Date() });
    const tokens = await this.issueTokens(stored.user);
    return { user: stored.user, tokens };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.refreshTokenRepository.update(
      { tokenHash: sha256(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenRepository.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('app.security.jwtSecret'),
      expiresIn: this.config.get<string>('app.security.jwtExpiresIn'),
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresInSeconds = this.config.get<number>('app.security.jwtRefreshExpiresIn')!;
    // `save(create())` (not `insert()`) so the entity listener generates the UUID.
    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      }),
    );

    return { accessToken, refreshToken };
  }

  /** Housekeeping: drop tokens that expired more than 7 days ago. */
  async cleanupExpiredTokens(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :cutoff', { cutoff })
      .execute();
    this.logger.debug('Expired refresh tokens cleaned up');
  }
}
