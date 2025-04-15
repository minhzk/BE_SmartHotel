import { forwardRef, Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { RoomAvailabilityModule } from '../room-availability/room-availability.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Room, RoomSchema } from '../rooms/schemas/room.schema';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { PaymentsModule } from '../payments/payments.module';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    RoomAvailabilityModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
