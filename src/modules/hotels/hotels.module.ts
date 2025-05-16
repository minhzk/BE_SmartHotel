import { Module } from '@nestjs/common';
import { HotelsService } from './hotels.service';
import { HotelsController } from './hotels.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from '../room-availability/schemas/room-availability.schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
    ConfigModule,
  ],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
