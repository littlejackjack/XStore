import { Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ExpiryReminderService } from './expiry-reminder.service';

/**
 * Daily job that emails customers whose subscription is about to expire.
 *
 * The actual work lives in ExpiryReminderService so the admin panel can run the
 * exact same logic on demand ("Send reminders now").
 */
@Processor('notifications')
export class SubscriptionExpiryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionExpiryProcessor.name);

  constructor(private readonly reminders: ExpiryReminderService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Subscription expiry reminder worker ready');
  }

  async process(job: Job): Promise<{ reminded: number }> {
    if (job.name !== 'subscription-expiry-reminders') return { reminded: 0 };
    const result = await this.reminders.sendDueReminders();
    return { reminded: result.reminded };
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
