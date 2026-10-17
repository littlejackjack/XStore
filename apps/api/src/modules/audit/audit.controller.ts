import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { AuditLog } from '../../database/entities/audit-log.entity';

@ApiTags('admin/audit')
@Roles('ADMIN')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async list(@Query() query: PaginationDto) {
    const repository = this.dataSource.getRepository(AuditLog);
    const [items, total] = await repository.findAndCount({
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
}
