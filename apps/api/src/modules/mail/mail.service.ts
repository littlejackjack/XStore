import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../apikeys/apikeys.service';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
