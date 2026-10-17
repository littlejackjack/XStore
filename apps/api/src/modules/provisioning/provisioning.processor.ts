import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { MarzbanService } from '../marzban/marzban.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { ServersService } from '../servers/servers.service';
import { randomUUID } from 'node:crypto';

interface ProvisionJob {
  orderId: string;
}

/**
 * Background provisioning worker (runs in the `worker` container).
 *
 * Triggered by the Bayar.gg webhook (or the payment-sync fallback) AFTER the
 * payment is verified. Creates the VPN user on the Marzban panel the buyer
 * selected, stores the subscription link, and emails the customer.
 *
 * Retries: 5 attempts with exponential backoff. On final failure the order is
 * marked FAILED with the reason so support can refund or retry manually.
 */
@Processor('provisioning')
export class ProvisioningProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(MarzbanServer)
    private readonly serverRepository: Repository<MarzbanServer>,
    private readonly marzban: MarzbanService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly serversService: ServersService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Provisioning worker ready');
  }

  async process(job: Job<ProvisionJob>): Promise<{ subscriptionId: string }> {
    if (job.name !== 'provision-subscription') return { subscriptionId: '' };

    const order = await this.orderRepository.findOne({
      where: { id: job.data.orderId },
      relations: { user: true, product: true, server: true },
    });

    if (!order) throw new Error(`Order ${job.data.orderId} not found`);
    if (order.status === 'COMPLETED') return { subscriptionId: '' }; // idempotent
    if (order.status !== 'PAID' && order.status !== 'PROVISIONING') {
      throw new Error(`Order ${order.orderNumber} is not payable (status ${order.status})`);
    }

    await this.orderRepository.update({ id: order.id }, { status: 'PROVISIONING' });

    const product: Product = order.product;
    const server: MarzbanServer = order.server;
    const marzbanUsername = `xstore_${order.orderNumber.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const expireAt = new Date(Date.now() + product.durationDays * 24 * 60 * 60 * 1000);
    const dataLimitBytes = product.dataLimitGb ? product.dataLimitGb * 1024 * 1024 * 1024 : null;

    let created;
    try {
      created = await this.marzban.createUser(server, {
        username: marzbanUsername,
        dataLimitBytes,
        expireAt: Math.floor(expireAt.getTime() / 1000),
        note: `XStore order ${order.orderNumber} - product ${product.name}`,
      });
    } catch (error) {
      const reason = (error as Error).message;
      this.logger.error(`Provisioning failed for order ${order.orderNumber}: ${reason}`);
      if (job.attemptsMade >= (job.opts.attempts ?? 1) - 1) {
        await this.orderRepository.update(
          { id: order.id },
          { status: 'FAILED', failureReason: reason.slice(0, 500) },
        );
      }
      throw error;
    }

    const subscription = this.subscriptionRepository.create({
      userId: order.userId,
      orderId: order.id,
      productId: product.id,
      serverId: server.id,
      marzbanUsername,
      subscriptionUrl: created.subscription_url ?? null,
      status: 'ACTIVE',
      dataLimitBytes,
      usedTrafficBytes: 0,
      expireAt,
    });
    const saved = await this.subscriptionRepository.save(subscription);

    await this.orderRepository.update({ id: order.id }, { status: 'COMPLETED' });

    // Keep the server's live user counter in sync.
    server.activeUsers += 1;
    await this.serverRepository.save(server);

    await this.audit.record({
      action: 'SUBSCRIPTION_PROVISIONED',
      entity: 'Subscription',
      entityId: saved.id,
      actorId: order.userId,
      actorEmail: order.user.email,
      metadata: { orderNumber: order.orderNumber, serverId: server.id, marzbanUsername },
    });

    if (created.subscription_url) {
      await this.mail.sendSubscriptionReady(order.user.email, product.name, created.subscription_url);
    }

    this.logger.log(`Subscription ${saved.id} provisioned for order ${order.orderNumber}`);
    return { subscriptionId: saved.id };
  }
}
