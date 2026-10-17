import { IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  productId: string;

  /** Server chosen by the buyer at checkout. */
  @IsUUID()
  serverId: string;
}
