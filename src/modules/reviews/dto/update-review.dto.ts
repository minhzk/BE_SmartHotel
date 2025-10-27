import { PartialType } from '@nestjs/mapped-types';
import { CreateReviewDto } from './create-review.dto';
import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';

export class UpdateReviewDto extends PartialType(CreateReviewDto) {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;

  @IsOptional()
  @IsNumber()
  sentiment?: number;

  @IsOptional()
  @IsString()
  sentiment_label?: string;
}

export class CreateResponseDto {
  @IsMongoId()
  @IsNotEmpty()
  review_id: string;

  @IsString()
  @IsNotEmpty()
  response_text: string;
}
