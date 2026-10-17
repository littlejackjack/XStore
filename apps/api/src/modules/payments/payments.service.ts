import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Order } from '../../database/entities/order.entity';
import { ApiKeysService } from '../apikeys/apikeys.service';

export interface CreatePaymentResult {
  invoiceId: string;
  paymentUrl: string;
  amount: number;
  finalAmount: number;
  status: string;
}

export interface CheckPaymentResult {
  invoiceId: string;
  status: string;
  amount: number;
  finalAmount: number;
  raw: Record<string, unknown>;
}

/**
 * Bayar.gg payment gateway integration.
 *
 * - API key is resolved from the encrypted Admin-Panel store (never .env).
 * - Every order gets its own invoice; `payment_url` is returned to the buyer.
 * - Status polling is the fallback when the webhook is delayed/lost.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async createPayment(order: Order, customer: { name: string; email: string }): Promise<CreatePaymentResult> {
    const { apiKey } = await this.apiKeys.resolve('BAYARGG');
    const baseUrl = this.config.get<string>('app.bayargg.baseUrl')!;
    const appUrl = this.config.get<string>('app.appUrl')!;

    const payload = {
      amount: Number(order.amountIdr),
      description: `XStore Order ${order.orderNumber}`,
      customer_name: customer.name,
      customer_email: customer.email,
      payment_url: this.config.get<string>('app.bayargg.checkoutUrl'),
      payment_method: this.config.get<string>('app.bayargg.paymentMethod'),
      callback_url: `${appUrl.replace(/\/+$/, '')}/api/webhooks/bayargg`,
      redirect_url: `${appUrl.replace(/\/+$/, '')}/dashboard?order=${order.orderNumber}`,
    };

    const response = await fetch(`${baseUrl}/create-payment.php`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;

    if (!response.ok || json.success === false) {
      this.logger.error(`Bayar.gg create-payment failed (${response.status}): ${JSON.stringify(json).slice(0, 500)}`);
      throw new BadRequestException(
        `Payment gateway rejected the request: ${json.message ?? json.error ?? response.status}`,
      );
    }

    // Bayar.gg returns either { data: {...} } or { payment: {...} }.
    const data = (json.data ?? json.payment ?? json) as Record<string, any>;
    const invoiceId: string = data.invoice_id ?? json.invoice_id;
    const paymentUrl: string = data.payment_url ?? json.payment_url;

    if (!invoiceId || !paymentUrl) {
      this.logger.error(`Bayar.gg response missing invoice/payment_url: ${JSON.stringify(json).slice(0, 500)}`);
      throw new BadRequestException('Payment gateway returned an unexpected response');
    }

    return {
      invoiceId,
      paymentUrl,
      amount: Number(data.amount ?? order.amountIdr),
      finalAmount: Number(data.final_amount ?? data.amount ?? order.amountIdr),
      status: String(data.status ?? 'pending'),
    };
  }

  /** Polls the gateway - used by the "sync payment" endpoint and as a safety net. */
  async checkPayment(invoiceId: string): Promise<CheckPaymentResult> {
    const { apiKey } = await this.apiKeys.resolve('BAYARGG');
    const baseUrl = this.config.get<string>('app.bayargg.baseUrl')!;

    const response = await fetch(`${baseUrl}/check-payment.php?invoice=${encodeURIComponent(invoiceId)}`, {
      headers: { 'X-API-Key': apiKey },
    });

    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || json.success === false) {
      throw new BadRequestException(`Payment gateway status check failed: ${json.message ?? response.status}`);
    }

    const data = (json.data ?? json.payment ?? json) as Record<string, any>;
    return {
      invoiceId,
      status: String(data.status ?? 'unknown'),
      amount: Number(data.amount ?? 0),
      finalAmount: Number(data.final_amount ?? data.amount ?? 0),
      raw: json,
    };
  }
}
