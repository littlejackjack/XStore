import { IsEmail, IsIn, IsOptional, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(['LOGIN', 'EMAIL_VERIFICATION'])
  purpose?: 'LOGIN' | 'EMAIL_VERIFICATION';
}

export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  /** The 6-digit code from the email. */
  @Matches(/^\d{6}$/, { message: 'The code must be exactly 6 digits' })
  code!: string;

  @IsOptional()
  @IsIn(['LOGIN', 'EMAIL_VERIFICATION'])
  purpose?: 'LOGIN' | 'EMAIL_VERIFICATION';
}
