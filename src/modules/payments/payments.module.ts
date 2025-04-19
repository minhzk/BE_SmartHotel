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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    forwardRef(() => BookingsModule),
    ConfigModule,
    EventEmitterModule.forRoot(),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, VnpayService, PaymentProcessorService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
