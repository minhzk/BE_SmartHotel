import { forwardRef, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { VnpayService } from './vnpay/vnpay.service';
import { BookingsModule } from '../bookings/bookings.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentProcessorService } from './payment-processor.service';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema }, // Thêm User model
    ]),
    forwardRef(() => BookingsModule),
    ConfigModule,
    EventEmitterModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, VnpayService, PaymentProcessorService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
