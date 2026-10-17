/**
 * Unit tests for the subscription expiry reminder logic.
 *
 * Verifies the two properties that matter in production: only ACTIVE
 * subscriptions inside the reminder window are emailed, and each one is
 * reminded at most once (the `expiry_reminder_sent_at` marker).
 */
import { ExpiryReminderService } from '../src/modules/provisioning/expiry-reminder.service';
import { SubscriptionExpiryProcessor } from '../src/modules/provisioning/subscription-expiry.processor';

const NOW = new Date('2026-10-17T07:00:00.000Z');

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60_000);
}

function build(subscriptions: any[], reminderDays = 3) {
  const stored = [...subscriptions];
  const subscriptionRepository = {
    // Mirrors the real query: ACTIVE, not yet expired, soonest expiry first.
    find: jest.fn(async () =>
      stored
        .filter((item) => item.status === 'ACTIVE' && item.expireAt && item.expireAt.getTime() >= Date.now())
        .sort((left, right) => left.expireAt.getTime() - right.expireAt.getTime()),
    ),
    update: jest.fn(async (criteria: any, patch: any) => {
      const target = stored.find((item) => item.id === criteria.id);
      if (target) Object.assign(target, patch);
      return { affected: target ? 1 : 0 };
    }),
  };
  const mail = { sendSubscriptionExpiring: jest.fn(async () => ({ ok: true })) };
  const settings = { get: jest.fn(async () => reminderDays) };
  const config = {
    get: jest.fn((key: string) => (key === 'app.otp.expiryReminderDays' ? 3 : 'https://xstore.example.com')),
  };

  const service = new ExpiryReminderService(
    subscriptionRepository as any,
    mail as any,
    settings as any,
    config as any,
  );
  return { service, subscriptionRepository, mail, stored };
}

const ACTIVE = (id: string, daysLeft: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'ACTIVE',
  expireAt: daysFromNow(daysLeft),
  expiryReminderSentAt: null,
  user: { id: `user-${id}`, email: `${id}@example.com` },
  product: { id: 'p1', name: 'Pro 1 Month' },
  ...extra,
});

describe('ExpiryReminderService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('emails subscriptions expiring inside the reminder window', async () => {
    const { service, mail, stored } = build([
      ACTIVE('soon', 2),
      ACTIVE('today', 0),
      ACTIVE('later', 10), // outside the 3-day window
      ACTIVE('already-reminded', 1, { expiryReminderSentAt: daysFromNow(-1) }),
      { ...ACTIVE('expired', -2), status: 'EXPIRED' },
    ]);

    const result = await service.sendDueReminders();

    expect(result).toEqual({ reminded: 2, windowDays: 3 });
    expect(mail.sendSubscriptionExpiring).toHaveBeenCalledTimes(2);
    const recipients = mail.sendSubscriptionExpiring.mock.calls
      .map((call: any[]) => call[0].email)
      .sort();
    expect(recipients).toEqual(['soon@example.com', 'today@example.com']);
    // Every reminded subscription is marked, so it is never emailed twice.
    expect(stored.find((item) => item.id === 'soon').expiryReminderSentAt).toBeInstanceOf(Date);
  });

  it('skips everything when nothing is due', async () => {
    const { service, mail } = build([ACTIVE('later', 30)]);
    expect(await service.sendDueReminders()).toEqual({ reminded: 0, windowDays: 3 });
    expect(mail.sendSubscriptionExpiring).not.toHaveBeenCalled();
  });

  it('honours the window configured in the admin panel', async () => {
    const { service, mail } = build([ACTIVE('week', 7)], 10);
    const result = await service.sendDueReminders();

    expect(result.windowDays).toBe(10);
    expect(result.reminded).toBe(1);
    expect(mail.sendSubscriptionExpiring).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one email fails', async () => {
    const { service, mail } = build([ACTIVE('first', 1), ACTIVE('second', 2)]);
    mail.sendSubscriptionExpiring = jest
      .fn()
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValue({ ok: true });

    const result = await service.sendDueReminders();
    expect(result.reminded).toBe(1);
  });

  it('falls back to the env default when the setting is unset', async () => {
    const { service } = build([], 0);
    expect((await service.sendDueReminders()).windowDays).toBe(3);
  });
});

describe('SubscriptionExpiryProcessor', () => {
  it('delegates to the shared service and ignores other jobs', async () => {
    const reminders = { sendDueReminders: jest.fn().mockResolvedValue({ reminded: 4, windowDays: 3 }) };
    const processor = new SubscriptionExpiryProcessor(reminders as any);

    expect(await processor.process({ name: 'subscription-expiry-reminders' } as any)).toEqual({ reminded: 4 });
    expect(await processor.process({ name: 'some-other-job' } as any)).toEqual({ reminded: 0 });
    expect(reminders.sendDueReminders).toHaveBeenCalledTimes(1);
  });

  it('schedules the job once a day (fixed jobId)', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    await SubscriptionExpiryProcessor.schedule(queue as any);

    expect(queue.add).toHaveBeenCalledWith(
      'subscription-expiry-reminders',
      {},
      expect.objectContaining({ jobId: 'subscription-expiry-reminders', repeat: expect.anything() }),
    );
  });
});
