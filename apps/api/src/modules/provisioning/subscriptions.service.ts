import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../../database/entities/subscription.entity';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { MarzbanService } from '../marzban/marzban.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly marzban: MarzbanService,
  ) {}

  /** Customer dashboard: own subscriptions with server + traffic info. */
  async listForUser(userId: string) {
    const subscriptions = await this.subscriptionRepository.find({
      where: { userId },
      relations: { product: true, server: true },
      order: { createdAt: 'DESC' },
    });
    return subscriptions.map((subscription) => this.toView(subscription));
  }

  async listAll() {
    const subscriptions = await this.subscriptionRepository.find({
      relations: { user: true, product: true, server: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return subscriptions.map((subscription) => ({
      ...this.toView(subscription),
      userEmail: subscription.user?.email,
    }));
  }

  /**
   * Refreshes traffic/expiry from the Marzban panel for a single subscription.
   * Owner or admin only.
   */
  async syncUsage(actor: { id: string; role: string }, id: string) {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: { server: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.userId !== actor.id && actor.role === 'USER') {
      throw new ForbiddenException('You can only view your own subscriptions');
    }

    const server: MarzbanServer = subscription.server;
    try {
      const user = (await this.marzban.getUser(server, subscription.marzbanUsername)) as Record<string, any>;
      subscription.usedTrafficBytes = Math.floor(Number(user.used_traffic ?? 0));
      if (user.expire) {
        subscription.expireAt = new Date(Number(user.expire) * 1000);
      }
      if (user.status) {
        const statusMap: Record<string, Subscription['status']> = {
          active: 'ACTIVE',
          expired: 'EXPIRED',
          disabled: 'DISABLED',
          limited: 'DEPLETED',
          on_hold: 'DISABLED',
        };
        subscription.status = statusMap[String(user.status)] ?? subscription.status;
      }
      await this.subscriptionRepository.save(subscription);
    } catch {
      /* panel unreachable - keep last known values */
    }
    return this.toView(subscription);
  }

  private toView(subscription: Subscription) {
    const remainingBytes =
      subscription.dataLimitBytes == null
        ? null
        : Math.max(0, Number(subscription.dataLimitBytes) - Number(subscription.usedTrafficBytes));

    return {
      id: subscription.id,
      marzbanUsername: subscription.marzbanUsername,
      subscriptionUrl: subscription.subscriptionUrl,
      status: subscription.status,
      product: subscription.product
        ? { id: subscription.product.id, name: subscription.product.name }
        : undefined,
      server: subscription.server
        ? { id: subscription.server.id, name: subscription.server.name, location: subscription.server.location }
        : undefined,
      dataLimitBytes: subscription.dataLimitBytes == null ? null : Number(subscription.dataLimitBytes),
      usedTrafficBytes: Number(subscription.usedTrafficBytes),
      remainingBytes,
      expireAt: subscription.expireAt,
      createdAt: subscription.createdAt,
    };
  }
}
