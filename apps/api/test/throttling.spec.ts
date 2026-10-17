/**
 * Rate limiting.
 *
 * Regression test: the @Throttle() decorators are INERT unless ThrottlerGuard is
 * registered as a global APP_GUARD. It was missing from AppModule, which silently
 * disabled every limit - including the brute-force protection on /auth/login and
 * on the API-key rotation endpoint.
 *
 * Part 1 proves the guard + module combination actually returns 429.
 * Part 2 proves AppModule really wires ThrottlerGuard (no boot required).
 */
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/throttle_test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = 'throttle-test-jwt-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY = 'throttle-test-encryption-key-32-chars-minimum';
process.env.NODE_ENV = 'test';

import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

@Controller()
class ProbeController {
  @Get('probe')
  probe(): string {
    return 'ok';
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 2 }])],
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ProbeModule {}

describe('rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows requests up to the limit and then returns 429', async () => {
    await request(app.getHttpServer()).get('/probe').expect(200);
    await request(app.getHttpServer()).get('/probe').expect(200);
    await request(app.getHttpServer()).get('/probe').expect(429);
  });
});

describe('AppModule guard wiring', () => {
  it('registers ThrottlerGuard globally (otherwise every limit is inert)', () => {
    const providers = (Reflect.getMetadata('providers', AppModule) ?? []) as Array<Record<string, unknown>>;
    const globalGuards = providers.filter((provider) => provider?.provide === APP_GUARD);

    expect(globalGuards.length).toBeGreaterThanOrEqual(3); // throttle, auth, roles
    expect(globalGuards.some((provider) => provider.useClass === ThrottlerGuard)).toBe(true);
    // The rate limiter must run BEFORE authentication.
    expect(globalGuards[0].useClass).toBe(ThrottlerGuard);
  });
});
