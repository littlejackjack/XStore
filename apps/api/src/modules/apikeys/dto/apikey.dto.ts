import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RotateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  apiKey?: string;

  /** Only used by BAYARGG - the whsec_... webhook signing secret. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  webhookSecret?: string;
}
