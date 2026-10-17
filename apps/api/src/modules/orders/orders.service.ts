import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { ProductsService } from '../products/products.service';
import { ServersService } from '../servers/servers.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from '../audit/audit.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { randomOrderSuffix } from '../../common/utils/random.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly productsService: ProductsService,
    private readonly serversService: ServersService,
    private readonly paymentsService: PaymentsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @InjectQueue('provisioning')
    private readonly provisioningQueue: Queue,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Checkout step 1: create the order + Bayar.gg invoice.
   * The buyer must have chosen an available server - it is re-validated here
   * server-side so a stale client cannot order on a full/offline server.
   */
  async create(user: User, dto: { productId: string; serverId: string }) {
    const product = await this.productsService.findPublicById(dto.productId);
    const server = await this.serversService.assertSelectable(dto.serverId);

    const orderNumber = `XST-${Date.now().toString(36).toUpperCase()}-${randomOrderSuffix(6)}`;

    const order = this.orderRepository.create({
      orderNumber,
      userId: user.id,
      productId: product.id,
      serverId: server.id,
      amountIdr: product.priceIdr,
      status: 'PENDING',
    });

    const saved = await this.orderRepository.save(order);

    // Create the payment invoice with the gateway.
    const payment = await this.paymentsService.createPayment(saved, {
      name: user.name,
      email: user.email,
    });

    saved.bayarInvoiceId = payment.invoiceId;
    saved.paymentUrl = payment.paymentUrl;
    await this.orderRepository.save(saved);

    await this.audit.record({
      action: 'ORDER_CREATED',
      entity: 'Order',
      entityId: saved.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { orderNumber, amountIdr: saved.amountIdr, serverId: server.id, productId: product.id },
    });

    return {
      order: this.toView(saved, product, server),
      paymentUrl: payment.paymentUrl,
    };
  }

  async listForUser(userId: string) {
    const orders = await this.orderRepository.find({
      where: { userId },
      relations: { product: true, server: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return orders.map((order) => this.toView(order, order.product, order.server));
  }

  /** Owner or any admin may view an order. */
  async findOne(actor: User, id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { product: true, server: true, user: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== actor.id && actor.role === 'USER') {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }

  /**
   * Fallback when the webhook is delayed: ask Bayar.gg directly.
   * If it reports `paid`, the order is promoted and provisioning is queued.
   */
  async syncPaymentStatus(actor: User, id: string) {
    const order = await this.findOne(actor, id);
    if (!order.bayarInvoiceId) throw new BadRequestException('This order has no payment invoice yet');
    if (order.status !== 'PENDING') return this.toView(order, order.product, order.server);

    const result = await this.paymentsService.checkPayment(order.bayarInvoiceId);
    if (result.status === 'paid') {
      order.status = 'PAID';
      order.paidAt = new Date();
      await this.orderRepository.save(order);
      await this.provisioningQueue.add(
        'provision-subscription',
        { orderId: order.id },
        { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
      );
    } else if (['expired', 'cancelled', 'failed'].includes(result.status)) {
      order.status = result.status === 'expired' ? 'EXPIRED' : 'CANCELLED';
      await this.orderRepository.save(order);
    }
    return this.toView(order, order.product, order.server);
  }

  async listAll(query: { page: number; limit: number; status?: string }) {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.product', 'product')
      .leftJoinAndSelect('order.server', 'server')
      .orderBy('order.createdAt', 'DESC');

    if (query.status) {
      qb.where('order.status = :status', { status: query.status });
    }

    const [items, total] = await qb.take(query.limit).skip((query.page - 1) * query.limit).getManyAndCount();
    return {
      items: items.map((order) => this.toView(order, order.product, order.server)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /** Sales statistics for the admin dashboard. */
  async stats() {
    const totalRevenue = await this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.amountIdr), 0)', 'total')
      .where('order.status IN (:...statuses)', { statuses: ['PAID', 'PROVISIONING', 'COMPLETED'] })
      .getRawOne<{ total: string }>();

    const byStatus = await this.orderRepository
      .createQueryBuilder('order')
      .select('order.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('order.status')
      .getRawMany<{ status: string; count: string }>();

    // Daily revenue series for the last 7 days. Raw SQL is used because the
    // date cast is not expressible through the query-builder alias parser.
    const last7Days = await this.dataSource.query(
      `SELECT "created_at"::date AS "date",
              COALESCE(SUM("amount_idr"), 0) AS "revenue",
              COUNT(*) AS "orders"
         FROM "orders"
        WHERE "status" = ANY($1)
          AND "created_at" >= NOW() - INTERVAL '7 days'
        GROUP BY "created_at"::date
        ORDER BY "date" ASC`,
      [['PAID', 'PROVISIONING', 'COMPLETED']],
    );

    return {
      totalRevenueIdr: Number(totalRevenue?.total ?? 0),
      ordersByStatus: Object.fromEntries(byStatus.map((row) => [row.status, Number(row.count)])),
      last7Days: (last7Days as Array<{ date: string; revenue: string; orders: string }>).map((row) => ({
        date: row.date,
        revenueIdr: Number(row.revenue),
        orders: Number(row.orders),
      })),
    };
  }

  /** Marks the order as failed (called by the provisioning worker). */
  async markFailed(orderId: string, reason: string): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status: 'FAILED', failureReason: reason.slice(0, 500) });
  }

  /** Marks the order as completed after the Marzban user was created. */
  async markCompleted(orderId: string): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status: 'COMPLETED' });
  }

  async markProvisioning(orderId: string): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status: 'PROVISIONING' });
  }

  async saveSubscription(subscription: Subscription): Promise<Subscription> {
    return this.subscriptionRepository.save(subscription);
  }

  private toView(order: Order, product?: Product, server?: MarzbanServer) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      amountIdr: Number(order.amountIdr),
      paymentUrl: order.paymentUrl,
      bayarInvoiceId: order.bayarInvoiceId,
      paidAt: order.paidAt,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      product: product ? { id: product.id, name: product.name, durationDays: product.durationDays } : undefined,
      server: server ? { id: server.id, name: server.name, location: server.location } : undefined,
    };
  }
}
