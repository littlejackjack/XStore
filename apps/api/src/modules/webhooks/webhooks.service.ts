import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { Payment } from '../../database/entities/payment.entity';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { hmacSha256Hex, safeEqual } from '../../common/utils/crypto.util';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

/** Reject callbacks whose timestamp is older than this (replay protection). */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

export interface BayarGgCallbackInput {
  payload: Record<string, any>;
  signature: string;
  timestamp: string;
  ip?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly apiKeys: ApiKeysService,
    private readonly config: ConfigService,
    @InjectQueue('provisioning')
    private readonly provisioningQueue: Queue,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async handleBayarGgCallback(input: BayarGgCallbackInput) {
    const { payload, signature, timestamp, ip } = input;

    // ---- 1. required fields ------------------------------------------------
    const invoiceId = String(payload.invoice_id ?? '');
    const status = String(payload.status ?? '');
    const finalAmount = String(payload.final_amount ?? payload.amount ?? '');
    if (!invoiceId || !status || !timestamp) {
      throw new BadRequestException('Malformed webhook payload');
    }

    // ---- 2. timestamp freshness -------------------------------------------
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      throw new UnauthorizedException('Invalid webhook timestamp');
    }
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
    if (ageSeconds > MAX_TIMESTAMP_SKEW_SECONDS) {
      throw new UnauthorizedException('Webhook timestamp outside the allowed window');
    }

    // ---- 3. HMAC signature -------------------------------------------------
    let webhookSecret: string | null = null;
    try {
      const resolved = await this.apiKeys.resolve('BAYARGG');
      webhookSecret = resolved.webhookSecret;
    } catch {
      throw new UnauthorizedException('Payment gateway credentials are not configured');
    }
    if (!webhookSecret) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }

    const signatureBase = `${invoiceId}|${status}|${finalAmount}|${timestamp}`;
    const expected = hmacSha256Hex(signatureBase, webhookSecret);
    if (!signature || !safeEqual(expected, signature.toLowerCase())) {
      this.logger.warn(`Rejected webhook with invalid signature (invoice ${invoiceId}, ip ${ip})`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // ---- 4. locate the order & cross-check the amount ----------------------
    const order = await this.orderRepository.findOne({
      where: { bayarInvoiceId: invoiceId },
      relations: { user: true, product: true },
    });
    if (!order) {
      this.logger.warn(`Webhook for unknown invoice ${invoiceId}`);
      // Acknowledge so the gateway stops retrying, but never process it.
      return { received: true, processed: false };
    }

    // ---- 5. persist the payment event (idempotent) -------------------------
    await this.paymentRepository.save(
      this.paymentRepository.create({
        orderId: order.id,
        invoiceId,
        amount: Number(finalAmount) || Number(order.amountIdr),
        status,
        rawPayload: payload,
      }),
    );

    if (status !== 'paid') {
      if (['expired', 'cancelled', 'failed'].includes(status)) {
        order.status = status === 'expired' ? 'EXPIRED' : 'CANCELLED';
        order.failureReason = status;
        await this.orderRepository.save(order);
      }
      return { received: true, processed: false };
    }

    if (order.status === 'PAID' || order.status === 'PROVISIONING' || order.status === 'COMPLETED') {
      // Already handled - idempotent acknowledgement.
      return { received: true, processed: false, duplicate: true };
    }

    const paidAmount = Number(payload.paid_amount ?? finalAmount);
    if (paidAmount && Number(order.amountIdr) > paidAmount) {
      order.status = 'FAILED';
      order.failureReason = 'paid amount is lower than the order amount';
      await this.orderRepository.save(order);
      this.logger.error(`Order ${order.orderNumber} underpaid: paid ${paidAmount}, expected ${order.amountIdr}`);
      return { received: true, processed: false };
    }

    order.status = 'PAID';
    order.paidAt = new Date();
    await this.orderRepository.save(order);

    // ---- 5b. notify the customer (payment + formal invoice) ---------------
    await this.notifyPayment(order, invoiceId, Number(payload.paid_amount ?? finalAmount));

    // ---- 6. hand over to the background worker ----------------------------
    await this.provisioningQueue.add(
      'provision-subscription',
      { orderId: order.id },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    this.logger.log(`Payment confirmed for order ${order.orderNumber} - provisioning queued`);
    return { received: true, processed: true };
  }

  /**
   * Payment-received notification + invoice email.
   * Email failures are logged but never fail the webhook: the gateway must
   * receive a 200 so it stops retrying, and provisioning continues anyway.
   */
  private async notifyPayment(order: Order, invoiceId: string, paidAmount: number): Promise<void> {
    if (!order.user?.email) return;
    try {
      await this.mail.sendPaymentReceived({
        email: order.user.email,
        orderNumber: order.orderNumber,
        amountIdr: paidAmount || Number(order.amountIdr),
        invoiceId,
      });
      await this.mail.sendInvoice({
        email: order.user.email,
        customerName: order.user.name,
        orderNumber: order.orderNumber,
        productName: order.product?.name ?? 'XStore subscription',
        durationDays: order.product?.durationDays ?? 0,
        amountIdr: paidAmount || Number(order.amountIdr),
        invoiceId,
        paidAt: order.paidAt ?? new Date(),
        siteName: (await this.settings.get<string>('site.name', 'XStore')),
      });
    } catch (error) {
      this.logger.error(`Failed to send payment emails for ${order.orderNumber}: ${(error as Error).message}`);
    }
  }
}
