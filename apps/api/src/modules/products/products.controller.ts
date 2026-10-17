import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, ParseUUIDPipe} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Public product catalog' })
  list() {
    return this.productsService.listPublic();
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Single product detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findPublicById(id);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/products')
  @ApiOperation({ summary: 'All products including inactive (admin)' })
  listAll() {
    return this.productsService.listAll();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Post('admin/products')
  create(@Body() dto: CreateProductDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.productsService.create(dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Put('admin/products/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.productsService.update(id, dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Patch('admin/products/:id')
  updatePartial(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() actor: User, @Req() request: Request) {
    return this.productsService.update(id, dto, { id: actor.id, email: actor.email }, request.ip);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Delete('admin/products/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User, @Req() request: Request) {
    return this.productsService.remove(id, { id: actor.id, email: actor.email }, request.ip);
  }
}
