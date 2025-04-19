import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking } from '../bookings/schemas/booking.schema';
import { Payment, PaymentType } from './schemas/payment.schema';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PaymentProcessorService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
    private eventEmitter: EventEmitter2,
  ) {}

  async processPaymentResult(
    payment: Payment,
    success: boolean,
  ): Promise<void> {
    if (!success) {
      // Emit payment failed event
      this.eventEmitter.emit('payment.failed', {
        paymentId: payment.transaction_id,
        bookingId: payment.booking_id,
      });
      return;
    }

    // Handle successful payment
    const bookingId = payment.booking_id;
    if (!bookingId) return;

    try {
      // Find the booking
      let booking = await this.bookingModel.findOne({ booking_id: bookingId });
      if (!booking) {
        console.error(`Booking ${bookingId} not found`);
        return;
      }

      // Update booking based on payment type
      if (payment.payment_type === PaymentType.DEPOSIT) {
        await this.bookingModel.updateOne(
          { booking_id: bookingId },
          {
            deposit_status: 'paid',
            payment_status: 'partially_paid',
            status: 'confirmed',
          },
        );
      } else if (payment.payment_type === PaymentType.REMAINING) {
        await this.bookingModel.updateOne(
          { booking_id: bookingId },
          {
            payment_status: 'paid',
          },
        );
      } else if (payment.payment_type === PaymentType.FULL_PAYMENT) {
        await this.bookingModel.updateOne(
          { booking_id: bookingId },
          {
            deposit_status: 'paid',
            payment_status: 'paid',
            status: 'confirmed',
          },
        );
      }

      // Emit payment success event
      this.eventEmitter.emit('payment.success', {
        paymentId: payment.transaction_id,
        bookingId: booking.booking_id,
        paymentType: payment.payment_type,
      });

      console.log(`Booking ${bookingId} updated after successful payment`);
    } catch (error) {
      console.error(`Error updating booking ${bookingId}:`, error.message);
      throw error;
    }
  }
}
