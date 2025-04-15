import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentType } from '../schemas/payment.schema';

export class CreateVnpayUrlDto {
  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsString()
  @IsNotEmpty()
  booking_id: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  amount: number;

  @IsEnum(PaymentType)
  @IsNotEmpty()
  payment_type: PaymentType;

  @IsString()
  @IsOptional()
  redirect_url?: string;

  @IsString()
  @IsOptional()
  client_ip?: string;

  @IsString()
  @IsOptional()
  bank_code?: string;
}
