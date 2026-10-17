import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { ServersService } from '../servers/servers.service';

/**
 * Repeatable background job that probes every enabled Marzban panel and
 * refreshes ONLINE/OFFLINE status + live active-user counts, so the checkout
 * list always shows accurate capacity information.
 */
@Processor('server-status')
export class ServerStatusProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ServerStatusProcessor.name);

  constructor(
    private readonly serversService: ServersService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Server status worker ready');
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'refresh-server-statuses') return;
    await this.serversService.refreshAllStatuses();
    this.logger.debug('Server statuses refreshed');
  }

  /** Registers the repeatable schedule (called once from the worker bootstrap). */
  static async schedule(queue: Queue, everyMinutes: number): Promise<void> {
    await queue.add(
      'refresh-server-statuses',
      {},
      {
        repeat: { every: Math.max(1, everyMinutes) * 60_000 },
        jobId: 'refresh-server-statuses', // prevents duplicates
        removeOnComplete: 20,
      },
    );
  }

  get intervalMinutes(): number {
    return this.config.get<number>('app.marzban.statusCheckIntervalMinutes')!;
  }
}
