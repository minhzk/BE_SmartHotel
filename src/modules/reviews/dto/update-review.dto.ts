import { PartialType } from '@nestjs/mapped-types';
import { CreateReviewDto } from './create-review.dto';
import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateReviewDto extends PartialType(CreateReviewDto) {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;
}

export class CreateResponseDto {
  @IsMongoId()
  @IsNotEmpty()
  review_id: string;

  @IsString()
  @IsNotEmpty()
  response_text: string;
}
