import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateServerDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @Matches(/^https?:\/\/.+/, { message: 'baseUrl must be a valid http(s) URL' })
  @MaxLength(255)
  baseUrl: string;

  @IsString()
  @MaxLength(120)
  username: string;

  /** Plain password - encrypted (AES-256-GCM) before it touches the database. */
  @IsString()
  @MaxLength(255)
  password: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\/.+/)
  @MaxLength(255)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxCapacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateServerStatusDto {
  @IsString()
  @Matches(/^(ONLINE|OFFLINE|MAINTENANCE)$/)
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
}
