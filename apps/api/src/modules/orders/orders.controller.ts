import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/order.dto';

class AdminOrdersQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'PROVISIONING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'])
  status?: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Checkout - create an order + payment invoice' })
  create(@CurrentUser() user: User, @Body() dto: CreateOrderDto, @Req() request: Request) {
    void request;
    return this.ordersService.create(user, dto);
  }

  @Get('orders/me')
  @ApiOperation({ summary: 'My orders' })
  myOrders(@CurrentUser() user: User) {
    return this.ordersService.listForUser(user.id);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Order detail (owner or admin)' })
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(user, id);
  }

  @Post('orders/:id/sync')
  @ApiOperation({ summary: 'Re-check payment status with Bayar.gg (webhook fallback)' })
  sync(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.syncPaymentStatus(user, id);
  }

  @Get('admin/orders')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'All orders (admin)' })
  listAll(@Query() query: AdminOrdersQuery) {
    return this.ordersService.listAll({ page: query.page, limit: query.limit, status: query.status });
  }

  @Get('admin/stats')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Sales statistics (admin dashboard)' })
  stats() {
    return this.ordersService.stats();
  }
}
