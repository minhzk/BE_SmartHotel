import { PartialType } from '@nestjs/mapped-types';
import { CreateBookingDto } from './create-booking.dto';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BookingStatus, PaymentStatus } from '../schemas/booking.schema';

export class UpdateBookingDto extends PartialType(CreateBookingDto) {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;

  @IsEnum(BookingStatus)
  @IsOptional()
  status?: BookingStatus;

  @IsEnum(PaymentStatus)
  @IsOptional()
  payment_status?: PaymentStatus;
}
