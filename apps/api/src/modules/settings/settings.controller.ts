import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../database/entities/user.entity';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  'site.name'?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  'site.tagline'?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  'site.currency'?: string;

  @IsOptional()
  @IsBoolean()
  'site.registrationEnabled'?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  'site.supportContact'?: string;

  @IsOptional()
  @IsBoolean()
  'order.autoProvision'?: boolean;
}

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('settings/public')
  @ApiOperation({ summary: 'Public site settings' })
  getPublic() {
    return this.settingsService.getPublic();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Get('admin/settings')
  @ApiOperation({ summary: 'All settings (admin)' })
  getAll() {
    return this.settingsService.getAll();
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @Put('admin/settings')
  @ApiOperation({ summary: 'Update settings (admin)' })
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: User) {
    return this.settingsService.update(dto as Record<string, unknown>, { id: actor.id, email: actor.email });
  }
}
