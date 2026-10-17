import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly audit: AuditService,
  ) {}

  /** Public catalog: active products only. */
  async listPublic() {
    return this.productRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async findPublicById(id: string): Promise<Product> {
    const product = await this.productRepository.findOneBy({ id });
    if (!product || !product.isActive) throw new NotFoundException('Product not found');
    return product;
  }

  async listAll() {
    return this.productRepository.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async create(dto: CreateProductDto, actor: { id: string; email: string }, ip?: string): Promise<Product> {
    const slug = dto.slug.trim().toLowerCase();
    const existing = await this.productRepository.findOneBy({ slug });
    if (existing) throw new ConflictException('A product with this slug already exists');

    const product = this.productRepository.create({
      ...dto,
      slug,
      dataLimitGb: dto.dataLimitGb ?? null,
      features: dto.features ?? [],
    });
    const saved = await this.productRepository.save(product);
    await this.audit.record({
      action: 'PRODUCT_CREATED',
      entity: 'Product',
      entityId: saved.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { name: saved.name, priceIdr: saved.priceIdr },
      ip,
    });
    return saved;
  }

  async update(id: string, dto: UpdateProductDto, actor: { id: string; email: string }, ip?: string): Promise<Product> {
    const product = await this.productRepository.findOneBy({ id });
    if (!product) throw new NotFoundException('Product not found');
    Object.assign(product, dto);
    const saved = await this.productRepository.save(product);
    await this.audit.record({
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: saved.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { changedFields: Object.keys(dto) },
      ip,
    });
    return saved;
  }

  /**
   * Deletes a product. Orders reference products forever, so a product that has
   * already been sold cannot be hard-deleted: it is deactivated instead (keeps
   * history + invoices intact) and the caller is told what happened.
   */
  async remove(
    id: string,
    actor: { id: string; email: string },
    ip?: string,
  ): Promise<{ deleted: boolean; deactivated?: boolean }> {
    const product = await this.productRepository.findOneBy({ id });
    if (!product) throw new NotFoundException('Product not found');

    try {
      await this.productRepository.remove(product);
    } catch (error) {
      if ((error as { code?: string }).code !== '23503') throw error; // not an FK violation
      await this.productRepository.update({ id }, { isActive: false });
      await this.audit.record({
        action: 'PRODUCT_DEACTIVATED',
        entity: 'Product',
        entityId: id,
        actorId: actor.id,
        actorEmail: actor.email,
        metadata: { name: product.name, reason: 'referenced by existing orders' },
        ip,
      });
      return { deleted: false, deactivated: true };
    }

    await this.audit.record({
      action: 'PRODUCT_DELETED',
      entity: 'Product',
      entityId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { name: product.name },
      ip,
    });
    return { deleted: true };
  }
}
