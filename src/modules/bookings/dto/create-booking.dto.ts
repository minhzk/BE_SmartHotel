import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  BookingStatus,
  CancellationPolicy,
  DepositStatus,
  PaymentStatus,
} from '../schemas/booking.schema';

export class CreateBookingDto {
  @IsMongoId()
  @IsNotEmpty()
  hotel_id: string;

  @IsMongoId()
  @IsNotEmpty()
  room_id: string;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  check_in_date: Date;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  check_out_date: Date;

  @IsNumber()
  @Min(0)
  @IsOptional()
  total_amount: number;

  @IsEnum(CancellationPolicy)
  @IsOptional()
  cancellation_policy: CancellationPolicy;

  @IsString()
  @IsOptional()
  guest_name: string;

  @IsString()
  @IsOptional()
  guest_email: string;

  @IsString()
  @IsOptional()
  guest_phone: string;

  @IsString()
  @IsOptional()
  special_requests: string;

  @IsNumber()
  @IsOptional()
  number_of_guests: number;

  @IsString()
  @IsEnum(['vnpay', 'wallet', 'cash'])
  @IsOptional()
  payment_method: string = 'vnpay';
}
