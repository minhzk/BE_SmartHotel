import { PartialType } from '@nestjs/mapped-types';
import { CreateRoomAvailabilityDto } from './create-room-availability.dto';

export class UpdateRoomAvailabilityDto extends PartialType(
  CreateRoomAvailabilityDto,
) {}
