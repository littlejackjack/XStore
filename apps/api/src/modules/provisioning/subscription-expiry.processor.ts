import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { Subscription } from '../../database/entities/subscription.entity';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Daily job that emails customers whose subscription is about to expire.
 *
 * - "About to expire" = ACTIVE, expires within the configured window
 *   (setting `notifications.expiryReminderDays`, default 3 days).
 * - Each subscription is reminded at most once per run: the
 *   `expiry_reminder_sent_at` timestamp is the dedupe marker, and it is only
 *   refreshed when a new reminder window opens again.
 */
@Processor('notifications')
export class SubscriptionExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionExpiryProcessor.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Subscription expiry reminder worker ready');
  }

  async process(job: Job): Promise<{ reminded: number }> {
    if (job.name !== 'subscription-expiry-reminders') return { reminded: 0 };

    const days = await this.reminderDays();
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60_000);

    const due = await this.subscriptionRepository.find({
      where: {
        status: 'ACTIVE',
        expireAt: MoreThanOrEqual(now),
      },
      relations: { user: true, product: true },
      order: { expireAt: 'ASC' },
      take: 200,
    });

    const expiring = due.filter(
      (subscription) =>
        subscription.expireAt !== null &&
        subscription.expireAt.getTime() <= horizon.getTime() &&
        // Not already reminded for the current window.
        (subscription.expiryReminderSentAt === null ||
          subscription.expiryReminderSentAt.getTime() < now.getTime() - days * 24 * 60 * 60_000),
    );

    let reminded = 0;
    for (const subscription of expiring) {
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

    if (reminded > 0) {
      this.logger.log(`Sent ${reminded} subscription expiry reminder(s)`);
    }
    return { reminded };
  }

  private async reminderDays(): Promise<number> {
    const fromSettings = await this.settings.get<number>('notifications.expiryReminderDays', 0);
    if (Number.isFinite(fromSettings) && Number(fromSettings) > 0) return Number(fromSettings);
    return this.config.get<number>('app.otp.expiryReminderDays') ?? 3;
  }

  /** Registers the daily schedule (called once from the worker bootstrap). */
  static async schedule(queue: Queue, hourUtc = 7): Promise<void> {
    await queue.add(
      'subscription-expiry-reminders',
      {},
      {
        repeat: { pattern: `0 ${hourUtc} * * *` }, // every day at 07:00 UTC
        jobId: 'subscription-expiry-reminders', // prevents duplicates
        removeOnComplete: 20,
      },
    );
  }
}
