import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarzbanServer } from '../../database/entities/marzban-server.entity';
import { encryptSecret } from '../../common/utils/crypto.util';
import { MarzbanService } from '../marzban/marzban.service';
import { AuditService } from '../audit/audit.service';
import { CreateServerDto, UpdateServerDto, UpdateServerStatusDto } from './dto/server.dto';

/** Admin-safe projection of a server row (never contains the encrypted password). */
export interface ServerAdminView {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  status: MarzbanServer['status'];
  activeUsers: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
  location: string | null;
  priority: number;
  notes: string | null;
  isActive: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape exposed to buyers at checkout (no credentials, ever). */
export interface AvailableServerView {
  id: string;
  name: string;
  location: string | null;
  status: MarzbanServer['status'];
  activeUsers: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
}

@Injectable()
export class ServersService {
  constructor(
    @InjectRepository(MarzbanServer)
    private readonly serverRepository: Repository<MarzbanServer>,
    private readonly marzban: MarzbanService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Servers shown at checkout: enabled, not in maintenance, with spare capacity. */
  async listAvailable(): Promise<AvailableServerView[]> {
    const servers = await this.serverRepository.find({
      where: { isActive: true },
      order: { priority: 'ASC', name: 'ASC' },
    });

    return servers
      .filter((server) => server.status !== 'MAINTENANCE')
      .filter((server) => server.maxCapacity == null || server.activeUsers < server.maxCapacity)
      .map((server) => this.toAvailableView(server));
  }

  /** Full admin listing - credentials stay server-side. */
  async listAll() {
    const servers = await this.serverRepository.find({ order: { priority: 'ASC', name: 'ASC' } });
    return servers.map((server) => this.toAdminView(server));
  }

  async findById(id: string): Promise<MarzbanServer> {
    const server = await this.serverRepository.findOneBy({ id });
    if (!server) throw new NotFoundException('Marzban server not found');
    return server;
  }

  async create(dto: CreateServerDto, actor: { id: string; email: string }, ip?: string): Promise<ServerAdminView> {
    const existing = await this.serverRepository.findOneBy({ baseUrl: dto.baseUrl.replace(/\/+$/, '') });
    if (existing) throw new ConflictException('A server with this base URL already exists');

    const server = this.serverRepository.create({
      name: dto.name.trim(),
      baseUrl: dto.baseUrl.trim().replace(/\/+$/, ''),
      username: dto.username.trim(),
      // Encrypt immediately - the plain password is never persisted.
      passwordEncrypted: encryptSecret(dto.password, this.config.get('app.security.encryptionKey')!),
      maxCapacity: dto.maxCapacity ?? null,
      location: dto.location ?? null,
      priority: dto.priority ?? 0,
      notes: dto.notes ?? null,
      isActive: dto.isActive ?? true,
      status: 'ONLINE',
    });

    const saved = await this.serverRepository.save(server);
    await this.audit.record({
      action: 'SERVER_CREATED',
      entity: 'MarzbanServer',
      entityId: saved.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { name: saved.name, baseUrl: saved.baseUrl, location: saved.location },
      ip,
    });
    return this.toAdminView(saved);
  }

  async update(id: string, dto: UpdateServerDto, actor: { id: string; email: string }, ip?: string): Promise<ServerAdminView> {
    const server = await this.findById(id);

    if (dto.baseUrl && dto.baseUrl.trim().replace(/\/+$/, '') !== server.baseUrl) {
      const clash = await this.serverRepository.findOneBy({ baseUrl: dto.baseUrl.trim().replace(/\/+$/, '') });
      if (clash) throw new ConflictException('A server with this base URL already exists');
      server.baseUrl = dto.baseUrl.trim().replace(/\/+$/, '');
      await this.marzban.invalidateToken(server.id);
    }
    if (dto.name) server.name = dto.name.trim();
    if (dto.username) {
      server.username = dto.username.trim();
      await this.marzban.invalidateToken(server.id);
    }
    if (dto.password) {
      server.passwordEncrypted = encryptSecret(dto.password, this.config.get('app.security.encryptionKey')!);
      await this.marzban.invalidateToken(server.id);
    }
    if (dto.isActive !== undefined) server.isActive = dto.isActive;
    if (dto.maxCapacity !== undefined) server.maxCapacity = dto.maxCapacity;
    if (dto.location !== undefined) server.location = dto.location;
    if (dto.priority !== undefined) server.priority = dto.priority;
    if (dto.notes !== undefined) server.notes = dto.notes;

    const saved = await this.serverRepository.save(server);
    await this.audit.record({
      action: 'SERVER_UPDATED',
      entity: 'MarzbanServer',
      entityId: saved.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { changedFields: Object.keys(dto) },
      ip,
    });
    return this.toAdminView(saved);
  }

  /** Sets ONLINE / OFFLINE / MAINTENANCE manually (e.g. planned maintenance). */
  async setStatus(id: string, dto: UpdateServerStatusDto, actor: { id: string; email: string }, ip?: string): Promise<ServerAdminView> {
    const server = await this.findById(id);
    const previous = server.status;
    server.status = dto.status;
    const saved = await this.serverRepository.save(server);
    await this.audit.record({
      action: 'SERVER_STATUS_CHANGED',
      entity: 'MarzbanServer',
      entityId: saved.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { from: previous, to: dto.status },
      ip,
    });
    return this.toAdminView(saved);
  }

  /**
   * On-demand connectivity probe used by the admin panel.
   * Updates the stored status + active user count on success.
   */
  async checkStatus(id: string): Promise<{ online: boolean; activeUsers: number; error?: string }> {
    const server = await this.findById(id);
    const result = await this.marzban.checkHealth(server);

    if (result.online) {
      server.status = 'ONLINE';
      server.activeUsers = result.activeUsers;
      server.lastError = null;
    } else {
      server.status = 'OFFLINE';
      server.lastError = result.error ?? 'unreachable';
    }
    server.lastCheckedAt = new Date();
    await this.serverRepository.save(server);
    return result;
  }

  /**
   * Background status refresh for ALL enabled servers.
   * Also refreshes the live user count so checkout capacity stays accurate.
   */
  async refreshAllStatuses(): Promise<void> {
    const servers = await this.serverRepository.find({ where: { isActive: true } });
    await Promise.all(
      servers.map(async (server) => {
        try {
          const result = await this.marzban.checkHealth(server);
          server.status = result.online ? 'ONLINE' : 'OFFLINE';
          server.activeUsers = result.activeUsers;
          server.lastError = result.error ?? null;
        } catch (error) {
          server.status = 'OFFLINE';
          server.lastError = (error as Error).message.slice(0, 64);
        }
        server.lastCheckedAt = new Date();
        await this.serverRepository.save(server);
      }),
    );
  }

  async remove(id: string, actor: { id: string; email: string }, ip?: string): Promise<void> {
    const server = await this.findById(id);
    await this.serverRepository.remove(server);
    await this.marzban.invalidateToken(server.id);
    await this.audit.record({
      action: 'SERVER_DELETED',
      entity: 'MarzbanServer',
      entityId: server.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { name: server.name, baseUrl: server.baseUrl },
      ip,
    });
  }

  /** Validates a checkout selection: server must exist, be enabled & reachable. */
  async assertSelectable(id: string): Promise<MarzbanServer> {
    const server = await this.findById(id);
    if (!server.isActive) throw new BadRequestException('This server is currently unavailable');
    if (server.status === 'MAINTENANCE') {
      throw new BadRequestException('This server is under maintenance, please choose another one');
    }
    if (server.status === 'OFFLINE') {
      throw new BadRequestException('This server is offline, please choose another one');
    }
    if (server.maxCapacity != null && server.activeUsers >= server.maxCapacity) {
      throw new BadRequestException('This server has reached its maximum capacity');
    }
    return server;
  }

  /**
   * Admin-safe projection of a server row. The encrypted password and every
   * other internal column are deliberately omitted - this is the ONLY shape
   * the HTTP layer is allowed to serialise.
   */
  toAdminView(server: MarzbanServer): ServerAdminView {
    return {
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      username: server.username,
      status: server.status,
      activeUsers: server.activeUsers,
      maxCapacity: server.maxCapacity,
      remainingCapacity: server.maxCapacity == null ? null : Math.max(0, server.maxCapacity - server.activeUsers),
      location: server.location,
      priority: server.priority,
      notes: server.notes,
      isActive: server.isActive,
      lastCheckedAt: server.lastCheckedAt,
      lastError: server.lastError,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
    };
  }

  private toAvailableView(server: MarzbanServer): AvailableServerView {
    return {
      id: server.id,
      name: server.name,
      location: server.location,
      status: server.status,
      activeUsers: server.activeUsers,
      maxCapacity: server.maxCapacity,
      remainingCapacity:
        server.maxCapacity == null ? null : Math.max(0, server.maxCapacity - server.activeUsers),
    };
  }
}
