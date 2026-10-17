import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { encryptSecret } from '../src/common/utils/crypto.util';

const MASTER_KEY = 'unit-test-encryption-key-32-chars-minimum';
const WEBHOOK_SECRET = 'whsec_test_secret_123';
const { hmacSha256Hex } = require('../src/common/utils/crypto.util');

function buildService(order: any) {
  const orderRepository = {
    findOne: jest.fn().mockResolvedValue(order),
    save: jest.fn(async (value: any) => value),
  };
  const paymentRepository = {
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => value),
  };
  const apiKeys = {
    resolve: jest.fn().mockResolvedValue({
      provider: 'BAYARGG',
      apiKey: 'pk_live_test',
      webhookSecret: WEBHOOK_SECRET,
      source: 'database',
    }),
  };
  const config = {
    get: jest.fn().mockReturnValue(MASTER_KEY),
  } as unknown as ConfigService;
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    sendPaymentReceived: jest.fn().mockResolvedValue({ ok: true }),
    sendInvoice: jest.fn().mockResolvedValue({ ok: true }),
  };
  const settings = { get: jest.fn().mockResolvedValue('XStore') };

  const service = new WebhooksService(
    orderRepository as any,
    paymentRepository as any,
    apiKeys as any,
    config as any,
    queue as any,
    mail as any,
    settings as any,
  );
  return { service, orderRepository, paymentRepository, queue, mail };
}

function sign(invoiceId: string, status: string, finalAmount: string, timestamp: string) {
  return hmacSha256Hex(`${invoiceId}|${status}|${finalAmount}|${timestamp}`, WEBHOOK_SECRET);
}

const ORDER = {
  id: 'order-1',
  orderNumber: 'XST-TEST-0001',
  amountIdr: 50000,
  status: 'PENDING',
  bayarInvoiceId: 'BAYAR-123',
  paidAt: null as Date | null,
  user: { id: 'user-1', email: 'buyer@example.com', name: 'Buyer' },
  product: { id: 'product-1', name: 'Pro 1 Month', durationDays: 30 },
};

describe('WebhooksService (Bayar.gg callback)', () => {
  const now = Math.floor(Date.now() / 1000).toString();
  const invoiceId = 'BAYAR-123';

  it('accepts a correctly signed paid callback and queues provisioning', async () => {
    const { service, orderRepository, queue } = buildService({ ...ORDER });
    const payload = {
      invoice_id: invoiceId,
      status: 'paid',
      final_amount: 50000,
      amount: 50000,
      paid_amount: 50000,
    };
    const result = await service.handleBayarGgCallback({
      payload,
      signature: sign(invoiceId, 'paid', '50000', now),
      timestamp: now,
      ip: '95.169.180.225',
    });

    expect(result).toEqual({ received: true, processed: true });
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID' }),
    );
    expect(queue.add).toHaveBeenCalledWith('provision-subscription', { orderId: 'order-1' }, expect.anything());
  });

  it('sends the payment notification and the invoice email (Resend)', async () => {
    const { service, mail } = buildService({ ...ORDER });
    await service.handleBayarGgCallback({
      payload: {
        invoice_id: invoiceId,
        status: 'paid',
        final_amount: 50000,
        amount: 50000,
        paid_amount: 50000,
      },
      signature: sign(invoiceId, 'paid', '50000', now),
      timestamp: now,
    });

    expect(mail.sendPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        orderNumber: 'XST-TEST-0001',
        amountIdr: 50000,
        invoiceId,
      }),
    );
    expect(mail.sendInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        customerName: 'Buyer',
        orderNumber: 'XST-TEST-0001',
        productName: 'Pro 1 Month',
        durationDays: 30,
        amountIdr: 50000,
        invoiceId,
      }),
    );
  });

  it('never fails the webhook when email delivery fails', async () => {
    const ctx = buildService({ ...ORDER });
    ctx.mail.sendPaymentReceived = jest.fn().mockRejectedValue(new Error('resend down'));
    const result = await ctx.service.handleBayarGgCallback({
      payload: { invoice_id: invoiceId, status: 'paid', final_amount: 50000, paid_amount: 50000 },
      signature: sign(invoiceId, 'paid', '50000', now),
      timestamp: now,
    });
    expect(result.processed).toBe(true); // gateway still gets its 200
    expect(ctx.queue.add).toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const { service, queue } = buildService({ ...ORDER });
    await expect(
      service.handleBayarGgCallback({
        payload: { invoice_id: invoiceId, status: 'paid', final_amount: 50000 },
        signature: 'deadbeef'.repeat(8),
        timestamp: now,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects a replayed (stale) timestamp', async () => {
    const { service } = buildService({ ...ORDER });
    const stale = (Math.floor(Date.now() / 1000) - 3600).toString();
    await expect(
      service.handleBayarGgCallback({
        payload: { invoice_id: invoiceId, status: 'paid', final_amount: 50000 },
        signature: sign(invoiceId, 'paid', '50000', stale),
        timestamp: stale,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('acknowledges unknown invoices without processing', async () => {
    const { service, queue } = buildService(null);
    const result = await service.handleBayarGgCallback({
      payload: { invoice_id: 'BAYAR-UNKNOWN', status: 'paid', final_amount: 50000 },
      signature: sign('BAYAR-UNKNOWN', 'paid', '50000', now),
      timestamp: now,
    });
    expect(result).toEqual({ received: true, processed: false });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-paid order', async () => {
    const { service, queue } = buildService({ ...ORDER, status: 'COMPLETED' });
    const result = await service.handleBayarGgCallback({
      payload: { invoice_id: invoiceId, status: 'paid', final_amount: 50000 },
      signature: sign(invoiceId, 'paid', '50000', now),
      timestamp: now,
    });
    expect(result).toEqual({ received: true, processed: false, duplicate: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('flags an underpaid order as FAILED', async () => {
    const { service, orderRepository } = buildService({ ...ORDER });
    const result = await service.handleBayarGgCallback({
      payload: { invoice_id: invoiceId, status: 'paid', final_amount: 10000, paid_amount: 10000 },
      signature: sign(invoiceId, 'paid', '10000', now),
      timestamp: now,
    });
    expect(result.processed).toBe(false);
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('stores the webhook secret encrypted at rest', () => {
    const envelope = encryptSecret(WEBHOOK_SECRET, MASTER_KEY);
    expect(envelope).not.toContain(WEBHOOK_SECRET);
  });
});
