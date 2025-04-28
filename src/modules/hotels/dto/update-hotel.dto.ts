import { PartialType } from '@nestjs/mapped-types';
import { CreateHotelDto } from './create-hotel.dto';
import { IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateHotelDto extends PartialType(CreateHotelDto) {
  @IsNotEmpty()
  @IsMongoId()
  _id: string;
}
