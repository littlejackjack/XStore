import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Subscription } from '../../database/entities/subscription.entity';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Subscription expiry reminders.
 *
 * Shared by the daily background job (`subscription-expiry.processor.ts`) and
 * by the admin "Send reminders now" action, so both paths behave identically.
 *
 * Guarantees:
 *  - only ACTIVE subscriptions that have not expired yet are considered,
 *  - only those inside the reminder window are emailed,
 *  - each subscription is reminded at most once per window
 *    (`expiry_reminder_sent_at` is the dedupe marker),
 *  - a failing email never aborts the whole run.
 */
@Injectable()
export class ExpiryReminderService {
  private readonly logger = new Logger(ExpiryReminderService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Reminder window in days: Admin Panel setting wins, env var is the default. */
  async reminderDays(): Promise<number> {
    const fromSettings = await this.settings.get<number>('notifications.expiryReminderDays', 0);
    if (Number.isFinite(fromSettings) && Number(fromSettings) > 0) return Number(fromSettings);
    return this.config.get<number>('app.otp.expiryReminderDays') ?? 3;
  }

  /** Sends the due reminders and returns how many went out. */
  async sendDueReminders(): Promise<{ reminded: number; windowDays: number }> {
    const days = await this.reminderDays();
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60_000);

    const candidates = await this.subscriptionRepository.find({
      where: { status: 'ACTIVE', expireAt: MoreThanOrEqual(now) },
      relations: { user: true, product: true },
      order: { expireAt: 'ASC' },
      take: 200,
    });

    const due = candidates.filter(
      (subscription) =>
        subscription.expireAt !== null &&
        subscription.expireAt.getTime() <= horizon.getTime() &&
        (subscription.expiryReminderSentAt === null ||
          subscription.expiryReminderSentAt.getTime() < now.getTime() - days * 24 * 60 * 60_000),
    );

    let reminded = 0;
    for (const subscription of due) {
      if (!subscription.user?.email) continue;
      const daysLeft = Math.max(
        0,
        Math.ceil((subscription.expireAt!.getTime() - now.getTime()) / (24 * 60 * 60_000)),
      );
      try {
        await this.mail.sendSubscriptionExpiring({
          email: subscription.user.email,
          productName: subscription.product?.name ?? 'XStore',
          daysLeft,
          expiresAt: subscription.expireAt!,
          renewUrl: `${this.config.get<string>('app.appUrl')!.replace(/\/+$/, '')}/catalog`,
          siteName: await this.settings.get<string>('site.name', 'XStore'),
        });
        await this.subscriptionRepository.update(
          { id: subscription.id },
          { expiryReminderSentAt: new Date() },
        );
        reminded += 1;
      } catch (error) {
        this.logger.error(
          `Expiry reminder failed for subscription ${subscription.id}: ${(error as Error).message}`,
        );
      }
    }

    if (reminded > 0) this.logger.log(`Sent ${reminded} subscription expiry reminder(s)`);
    return { reminded, windowDays: days };
  }
}
