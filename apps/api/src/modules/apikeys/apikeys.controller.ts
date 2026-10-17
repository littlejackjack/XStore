import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { ApiKeysService } from './apikeys.service';
import { RotateApiKeyDto } from './dto/apikey.dto';
import { ApiKeyProvider } from '../../database/entities/api-key.entity';

/**
 * API key management. Secrets are encrypted at rest, never returned to the
 * client, and every rotation is written to the audit log. Restricted to
 * SUPER_ADMIN.
 */
@ApiTags('admin/api-keys')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List configured providers (masked values only)' })
  list() {
    return this.apiKeysService.list();
  }

  @Put(':provider')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate API key / webhook secret for a provider' })
  async rotate(
    @CurrentUser() actor: User,
    @Param('provider') provider: ApiKeyProvider,
    @Body() dto: RotateApiKeyDto,
    @Req() request: Request,
  ) {
    return this.apiKeysService.rotate(
      provider,
      { apiKey: dto.apiKey, webhookSecret: dto.webhookSecret },
      { id: actor.id, email: actor.email },
      request.ip,
    );
  }

  @Post(':provider/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the stored key against the provider API' })
  async verify(@Param('provider') provider: ApiKeyProvider) {
    if (provider === 'BAYARGG') {
      // Lightweight authenticated call - returns the available payment methods.
      const { apiKey } = await this.apiKeysService.getOrThrow('BAYARGG');
      const baseUrl = 'https://www.bayar.gg/api';
      const response = await fetch(`${baseUrl}/get-payment-methods.php`, {
        headers: { 'X-API-Key': apiKey },
      });
      const ok = response.ok;
      return { provider, verified: ok, status: response.status };
    }

    if (provider === 'RESEND') {
      const { apiKey } = await this.apiKeysService.getOrThrow('RESEND');
      const response = await fetch('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { provider, verified: response.ok, status: response.status };
    }

    return { provider, verified: false, status: 400 };
  }
}
