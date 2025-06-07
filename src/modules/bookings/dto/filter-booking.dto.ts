import { IsOptional, IsString } from 'class-validator';

export class FilterBookingDto {
  @IsOptional()
  @IsString()
  dateRange?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  payment_status?: string;

  @IsOptional()
  @IsString()
  deposit_status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  user_id?: string;
}
