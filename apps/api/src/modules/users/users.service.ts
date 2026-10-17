import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserRole } from '../../database/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.userRepository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email: email.toLowerCase() });
  }

  async list(page: number, limit: number) {
    const [items, total] = await this.userRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });
    return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Admin updates a user's role / status. Guards against self-lockout. */
  async updateRoleOrStatus(actor: User, userId: string, changes: { role?: UserRole; status?: 'ACTIVE' | 'SUSPENDED' }) {
    if (actor.id === userId && (changes.role || changes.status)) {
      throw new ForbiddenException('You cannot change your own role or status');
    }
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (changes.role) user.role = changes.role;
    if (changes.status) user.status = changes.status;
    return this.userRepository.save(user);
  }
}
