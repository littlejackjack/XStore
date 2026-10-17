import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { RequestOtpDto, VerifyOtpDto } from '../otp/dto/otp.dto';
import { User } from '../../database/entities/user.entity';

export const REFRESH_COOKIE = 'xstore_refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Authentication endpoints.
 *
 * - Access token (JWT, short lived) is returned in the response body and sent
 *   by clients in the `Authorization: Bearer <token>` header.
 * - Refresh token (long lived, random, hashed at rest) is delivered BOTH as an
 *   httpOnly + Secure + SameSite=Strict cookie (browser flows) and in the body
 *   (mobile/CLI clients). Rotation revokes the previous token.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create a new customer account' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const { user, tokens } = await this.authService.register(dto);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user: this.sanitise(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { user, tokens } = await this.authService.login(dto.email, dto.password);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user: this.sanitise(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  /**
   * Passwordless login (step 1): email a 6-digit code.
   * Rate limited to 3/minute - the service additionally enforces a 60s
   * cooldown per address.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a one-time login / verification code by email' })
  async requestOtp(@Body() dto: RequestOtpDto, @Req() request: Request) {
    await this.authService.requestOtp(dto.email, dto.purpose ?? 'LOGIN', request.ip);
    return { sent: true, expiresInMinutes: 10 };
  }

  /**
   * Passwordless login (step 2): exchange the code for tokens.
   * For EMAIL_VERIFICATION the response only confirms the address.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a one-time code (login or email verification)' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) response: Response) {
    if ((dto.purpose ?? 'LOGIN') === 'EMAIL_VERIFICATION') {
      return this.authService.verifyEmailWithOtp(dto.email, dto.code);
    }

    const { user, tokens } = await this.authService.loginWithOtp(dto.email, dto.code);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user: this.sanitise(user), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and receive a new access token' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = this.readRefreshToken(request);
    const { user, tokens } = await this.authService.refresh(token);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { user: this.sanitise(user), accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = this.readRefreshToken(request);
    await this.authService.logout(token);
    response.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return undefined;
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  async me(@CurrentUser() user: User) {
    return { user: this.sanitise(user) };
  }

  /** Reads the refresh token from the httpOnly cookie or the request body. */
  private readRefreshToken(request: Request): string {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const fromCookie = cookies[REFRESH_COOKIE];
    const fromBody = (request.body as { refreshToken?: string } | undefined)?.refreshToken;
    const token = fromCookie ?? fromBody;
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    return token;
  }

  private setRefreshCookie(response: Response, token: string): void {
    const isProduction = this.config.get<boolean>('app.isProduction');
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.get<number>('app.security.jwtRefreshExpiresIn')! * 1000,
    });
  }

  private sanitise(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _ignored, ...safe } = user;
    void _ignored;
    return safe as Omit<User, 'passwordHash'>;
  }
}
