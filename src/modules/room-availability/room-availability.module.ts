import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoomAvailabilityService } from './room-availability.service';
import { RoomAvailabilityController } from './room-availability.controller';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from './schemas/room-availability.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
  ],
  controllers: [RoomAvailabilityController],
  providers: [RoomAvailabilityService],
  exports: [RoomAvailabilityService],
})
export class RoomAvailabilityModule {}
