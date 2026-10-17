import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  // Correct client IPs behind Caddy / Cloudflare.
  app.set('trust proxy', config.get<boolean>('app.trustProxy') ? 1 : false);

  // Global prefix: everything is served under /api (Caddy routes /api/* here).
  app.setGlobalPrefix('api');

  // Security headers. The API only returns JSON, so a strict CSP is safe.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(cookieParser());

  // CORS: only the configured front-end origins may call the API.
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  });

  // OpenAPI docs - disabled in production unless explicitly enabled.
  if (config.get<boolean>('app.swaggerEnabled')) {
    const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
    const document = new DocumentBuilder()
      .setTitle('XStore API')
      .setDescription('Secure multi-server Marzban subscription store API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, document as never);
    new Logger('Swagger').log('API docs available at /api/docs');
  }

  const port = config.get<number>('app.port')!;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`XStore API listening on port ${port} (${config.get('app.env')})`);
}

void bootstrap();
