import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { RoomStatus } from '../schemas/room-availability.schema';
import { Type } from 'class-transformer';

export class CreateRoomAvailabilityDto {
  @IsString()
  @IsNotEmpty()
  room_id: string;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  date: Date;

  @IsEnum(RoomStatus)
  @IsOptional()
  status: RoomStatus = RoomStatus.AVAILABLE;

  @IsNumber()
  @IsOptional()
  price_override: number | null = null;
}
