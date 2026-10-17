import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

/**
 * Bayar.gg callback endpoint.
 *
 * Verification (in this exact order):
 *  1. HMAC-SHA256 over `invoice_id|status|final_amount|timestamp` using the
 *     Webhook Secret Key stored encrypted in the database.
 *  2. Timestamp freshness window (reject replays older than 5 minutes).
 *  3. Constant-time signature comparison.
 *  4. Amount cross-check against our own order record.
 *  5. Idempotency: an already-paid order is acknowledged but not reprocessed.
 *
 * Configure in Bayar.gg dashboard: Developer -> Webhook & Callback
 * URL: https://<your-domain>/api/webhooks/bayargg
 */
@ApiExcludeController()
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('bayargg')
  @HttpCode(200)
  async handle(
    @Body() payload: Record<string, any>,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
    @Req() request: Request,
  ) {
    return this.webhooksService.handleBayarGgCallback({
      payload,
      signature: signature ?? '',
      timestamp: timestamp ?? '',
      ip: request.ip,
    });
  }
}
