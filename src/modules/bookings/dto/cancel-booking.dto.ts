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
  _id: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  cancellation_reason: string;
}
