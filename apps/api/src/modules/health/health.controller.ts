import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../../redis/redis.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness/readiness probe (used by Docker healthcheck)' })
  async check() {
    let database = false;
    try {
      await this.dataSource.query('SELECT 1');
      database = true;
    } catch {
      database = false;
    }

    const redis = await this.redis.ping();

    return {
      status: database ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      services: { database, redis },
    };
  }
}
