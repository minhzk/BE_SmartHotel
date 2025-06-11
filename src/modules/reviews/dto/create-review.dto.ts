import { Type } from 'class-transformer';
import {
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

class ResponseDto {
  @IsString()
  @IsNotEmpty()
  response_text: string;
}

export class CreateReviewDto {
  @IsMongoId()
  @IsNotEmpty()
  hotel_id: string;

  @IsMongoId()
  @IsNotEmpty()
  booking_id: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsNotEmpty()
  rating: number;

  @IsString()
  @IsNotEmpty()
  review_text: string;
}
