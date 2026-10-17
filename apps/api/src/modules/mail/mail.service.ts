import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../apikeys/apikeys.service';
import { OtpPurpose } from '../../database/entities/email-otp.entity';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Transactional email through Resend.
 * The API key is resolved at call time from the encrypted store (Admin Panel),
 * never from .env, and never returned to any client.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async send(input: SendEmailInput): Promise<{ ok: boolean; skipped?: boolean }> {
    let apiKey: string;
    try {
      const resolved = await this.apiKeys.resolve('RESEND');
      apiKey = resolved.apiKey;
    } catch {
      this.logger.warn('RESEND API key not configured - skipping email delivery');
      return { ok: false, skipped: true };
    }

    try {
      const response = await fetch(`${this.config.get('app.resend.baseUrl')}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get('app.resend.fromEmail'),
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(`Resend API error ${response.status}: ${detail.slice(0, 300)}`);
        return { ok: false };
      }
      return { ok: true };
    } catch (error) {
      this.logger.error(`Resend request failed: ${(error as Error).message}`);
      return { ok: false };
    }
  }

  /** One-time login / verification code. */
  async sendOtpCode(email: string, code: string, ttlMinutes: number, purpose: OtpPurpose): Promise<void> {
    const isLogin = purpose === 'LOGIN';
    await this.send({
      to: email,
      subject: isLogin ? `Kode login XStore: ${code}` : `Kode verifikasi email XStore: ${code}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <h2>${isLogin ? 'Kode login Anda' : 'Verifikasi email Anda'}</h2>
          <p>Gunakan kode berikut untuk ${isLogin ? 'masuk ke akun XStore' : 'memverifikasi alamat email Anda'}:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f4f5;padding:16px;border-radius:8px;text-align:center">${code}</p>
          <p style="color:#71717a;font-size:13px">Kode berlaku <strong>${ttlMinutes} menit</strong> dan hanya bisa dipakai satu kali.
          Jangan bagikan kode ini kepada siapa pun - tim XStore tidak pernah memintanya.</p>
        </div>`,
      text: `Kode XStore Anda: ${code} (berlaku ${ttlMinutes} menit)`,
    });
  }

  /** Sent the moment Bayar.gg confirms a payment. */
  async sendPaymentReceived(input: {
    email: string;
    orderNumber: string;
    amountIdr: number;
    invoiceId: string;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: `Pembayaran diterima - ${input.orderNumber}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <h2>Pembayaran diterima ✅</h2>
          <p>Order <strong>${escapeHtml(input.orderNumber)}</strong> sudah lunas.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:6px 0;color:#71717a">Invoice</td><td style="text-align:right;font-family:monospace">${escapeHtml(input.invoiceId)}</td></tr>
            <tr><td style="padding:6px 0;color:#71717a">Jumlah dibayar</td><td style="text-align:right;font-weight:bold">${formatIdr(input.amountIdr)}</td></tr>
          </table>
          <p>Langganan Anda sedang disiapkan. Anda akan menerima email berisi link subscription
          beberapa saat lagi. Pantau statusnya di dashboard XStore.</p>
        </div>`,
      text: `Pembayaran untuk order ${input.orderNumber} telah diterima (${formatIdr(input.amountIdr)}). Invoice: ${input.invoiceId}`,
    });
  }

  /** Formal invoice email, sent once the payment is confirmed. */
  async sendInvoice(input: {
    email: string;
    customerName: string;
    orderNumber: string;
    productName: string;
    durationDays: number;
    amountIdr: number;
    invoiceId: string;
    paidAt: Date;
    siteName: string;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: `Invoice ${input.orderNumber} - ${input.siteName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e4e4e7;padding-bottom:12px">
            <div><h1 style="margin:0;font-size:22px">${escapeHtml(input.siteName)}</h1>
            <p style="margin:4px 0 0;color:#71717a;font-size:13px">Invoice pembayaran</p></div>
            <div style="text-align:right">
              <p style="margin:0;font-weight:bold">${escapeHtml(input.orderNumber)}</p>
              <p style="margin:4px 0 0;color:#71717a;font-size:13px">${input.paidAt.toLocaleDateString('id-ID', { dateStyle: 'long' })}</p>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
            <thead><tr style="color:#71717a;text-align:left">
              <th style="padding:8px 0">Deskripsi</th><th style="padding:8px 0;text-align:right">Jumlah</th></tr></thead>
            <tbody><tr>
              <td style="padding:8px 0">${escapeHtml(input.productName)} (${input.durationDays} hari)</td>
              <td style="padding:8px 0;text-align:right">${formatIdr(input.amountIdr)}</td></tr></tbody>
            </table>
          <p style="text-align:right;font-size:18px;font-weight:bold;margin-top:8px">Total ${formatIdr(input.amountIdr)}</p>
          <p style="color:#71717a;font-size:13px">Ditagihkan kepada ${escapeHtml(input.customerName)} &lt;${escapeHtml(input.email)}&gt;<br>
          Referensi pembayaran: ${escapeHtml(input.invoiceId)}</p>
          <p style="color:#a1a1aa;font-size:12px;margin-top:24px">Email ini dikirim otomatis oleh ${escapeHtml(input.siteName)}.</p>
        </div>`,
      text: `Invoice ${input.orderNumber}\n${input.productName} (${input.durationDays} hari) - ${formatIdr(input.amountIdr)}\nReferensi: ${input.invoiceId}`,
    });
  }

  /** Reminder sent before a subscription expires. */
  async sendSubscriptionExpiring(input: {
    email: string;
    productName: string;
    daysLeft: number;
    expiresAt: Date;
    renewUrl: string;
    siteName: string;
  }): Promise<void> {
    await this.send({
      to: input.email,
      subject: `Langganan ${input.productName} Anda berakhir dalam ${input.daysLeft} hari`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <h2>Langganan akan berakhir ⏳</h2>
          <p>Paket <strong>${escapeHtml(input.productName)}</strong> Anda akan berakhir pada
          <strong>${input.expiresAt.toLocaleDateString('id-ID', { dateStyle: 'long' })}</strong>
          (${input.daysLeft} hari lagi).</p>
          <p>Perpanjang sekarang agar koneksi Anda tidak terputus:</p>
          <p><a href="${escapeHtml(input.renewUrl)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Perpanjang langganan</a></p>
          <p style="color:#71717a;font-size:12px">Email otomatis dari ${escapeHtml(input.siteName)}.</p>
        </div>`,
      text: `Langganan ${input.productName} berakhir ${input.expiresAt.toISOString().slice(0, 10)} (${input.daysLeft} hari). Perpanjang: ${input.renewUrl}`,
    });
  }

  /** Sent after a subscription is provisioned on Marzban. */
  async sendSubscriptionReady(email: string, productName: string, subscriptionUrl: string): Promise<void> {
    await this.send({
      to: email,
      subject: `Your ${productName} subscription is ready`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <h2>Terima kasih atas pembelian Anda 🎉</h2>
          <p>Paket <strong>${escapeHtml(productName)}</strong> sudah aktif.</p>
          <p>Salin link subscription berikut ke aplikasi VPN Anda (v2rayNG, Nekoray, Streisand, dll):</p>
          <p style="word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">${escapeHtml(subscriptionUrl)}</p>
          <p style="color:#71717a;font-size:12px">Email ini dikirim otomatis oleh XStore.</p>
        </div>`,
      text: `Your ${productName} subscription is ready. Subscription URL: ${subscriptionUrl}`,
    });
  }
}

function formatIdr(value: number): string {
  return `Rp ${Number(value).toLocaleString('id-ID')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
