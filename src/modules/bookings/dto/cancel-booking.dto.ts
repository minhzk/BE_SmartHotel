import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CancelBookingDto {
  @IsMongoId()
  @IsNotEmpty()
  booking_id: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  cancellation_reason: string;
}
