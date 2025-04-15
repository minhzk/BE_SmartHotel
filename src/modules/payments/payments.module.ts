import { forwardRef, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { VnpayService } from './vnpay/vnpay.service';
import { BookingsModule } from '../bookings/bookings.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    forwardRef(() => BookingsModule),
    ConfigModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, VnpayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
