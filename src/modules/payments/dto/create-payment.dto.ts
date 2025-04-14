import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentMethod, PaymentType } from '../schemas/payment.schema';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  booking_id: string;

  @IsEnum(PaymentType)
  @IsNotEmpty()
  payment_type: PaymentType;

  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  payment_method: PaymentMethod;

  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @IsString()
  @IsOptional()
  redirect_url?: string;

  @IsString()
  @IsOptional()
  client_ip?: string;
}
