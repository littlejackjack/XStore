/**
 * Unit tests for the daily subscription-expiry reminder job.
 *
 * Verifies the two properties that matter in production: only ACTIVE
 * subscriptions inside the reminder window are emailed, and each one is
 * reminded at most once (the `expiry_reminder_sent_at` marker).
 */
import { SubscriptionExpiryProcessor } from '../src/modules/provisioning/subscription-expiry.processor';

const NOW = new Date('2026-10-17T07:00:00.000Z');

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60_000);
}

function build(subscriptions: any[]) {
  const stored = [...subscriptions];
  const subscriptionRepository = {
    // Mirrors the real query: ACTIVE, not yet expired, newest expiry first.
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
  const settings = { get: jest.fn(async () => 3) };
  const config = { get: jest.fn(() => 'https://xstore.example.com') };

  const processor = new SubscriptionExpiryProcessor(
    subscriptionRepository as any,
    mail as any,
    settings as any,
    config as any,
  );
  return { processor, subscriptionRepository, mail, stored };
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

describe('SubscriptionExpiryProcessor', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('emails subscriptions expiring inside the reminder window', async () => {
    const { processor, mail, stored } = build([
      ACTIVE('soon', 2),
      ACTIVE('today', 0),
      ACTIVE('later', 10), // outside the 3-day window
      ACTIVE('already-reminded', 1, { expiryReminderSentAt: daysFromNow(-1) }),
      { ...ACTIVE('expired', -2), status: 'EXPIRED' },
    ]);

    const result = await processor.process({ name: 'subscription-expiry-reminders' } as any);

    expect(result.reminded).toBe(2);
    expect(mail.sendSubscriptionExpiring).toHaveBeenCalledTimes(2);
    const recipients = mail.sendSubscriptionExpiring.mock.calls
      .map((call: any[]) => call[0].email)
      .sort();
    expect(recipients).toEqual(['soon@example.com', 'today@example.com']);
    // Every reminded subscription is marked, so it is never emailed twice.
    expect(stored.find((item) => item.id === 'soon').expiryReminderSentAt).toBeInstanceOf(Date);
  });

  it('skips everything when nothing is due', async () => {
    const { processor, mail } = build([ACTIVE('later', 30)]);
    const result = await processor.process({ name: 'subscription-expiry-reminders' } as any);

    expect(result.reminded).toBe(0);
    expect(mail.sendSubscriptionExpiring).not.toHaveBeenCalled();
  });

  it('ignores unrelated jobs', async () => {
    const { processor, mail } = build([ACTIVE('soon', 1)]);
    const result = await processor.process({ name: 'some-other-job' } as any);

    expect(result).toEqual({ reminded: 0 });
    expect(mail.sendSubscriptionExpiring).not.toHaveBeenCalled();
  });

  it('keeps going when one email fails', async () => {
    const { processor, mail } = build([ACTIVE('first', 1), ACTIVE('second', 2)]);
    mail.sendSubscriptionExpiring = jest
      .fn()
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValue({ ok: true });

    const result = await processor.process({ name: 'subscription-expiry-reminders' } as any);
    expect(result.reminded).toBe(1);
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
