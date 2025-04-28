import { PartialType } from '@nestjs/mapped-types';
import { CreateRoomDto } from './create-room.dto';
import { IsMongoId, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @IsNotEmpty()
  @IsMongoId()
  _id: string;
}