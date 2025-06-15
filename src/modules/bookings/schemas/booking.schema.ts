import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELED = 'canceled',
  COMPLETED = 'completed',
  EXPIRED = 'expired', // Thêm trạng thái hết hạn
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired', // Thêm trạng thái hết hạn thanh toán
}

export enum DepositStatus {
  PAID = 'paid',
  UNPAID = 'unpaid',
}

export enum CancellationPolicy {
  CANCELABLE = 'cancelable',
  NON_CANCELABLE = 'non-cancelable',
}

@Schema({ timestamps: true })
export class Booking {
  @Prop({ type: String, required: true, unique: true })
  booking_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  user_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotel_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true })
  room_id: string;

  @Prop({ required: true })
  check_in_date: Date; // Mặc định là 14:00 PM ngày check-in

  @Prop({ required: true })
  check_out_date: Date; // Mặc định là 12:00 PM ngày check-out

  @Prop({ required: true })
  total_amount: number;

  @Prop()
  deposit_amount: number;

  @Prop({ type: String, enum: DepositStatus, default: DepositStatus.UNPAID })
  deposit_status: DepositStatus;

  @Prop()
  remaining_amount: number;

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING })
  status: BookingStatus;

  @Prop({
    type: String,
    enum: CancellationPolicy,
    default: CancellationPolicy.CANCELABLE,
  })
  cancellation_policy: CancellationPolicy;

  @Prop()
  cancelled_at: Date;

  @Prop()
  cancellation_reason: string;

  @Prop()
  payment_due_date: Date;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING })
  payment_status: PaymentStatus;

  @Prop({ type: String, enum: ['vnpay', 'wallet', 'cash'], default: 'vnpay' })
  payment_method: string;

  // Thông tin thêm về người đặt phòng
  @Prop()
  guest_name: string;

  @Prop()
  guest_email: string;

  @Prop()
  guest_phone: string;

  @Prop()
  special_requests: string;

  @Prop()
  number_of_guests: number;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
BookingSchema.index({ booking_id: 1 }, { unique: true });
BookingSchema.index({ user_id: 1 });
BookingSchema.index({ hotel_id: 1 });
BookingSchema.index({ room_id: 1 });
BookingSchema.index({ check_in_date: 1, check_out_date: 1 });
BookingSchema.index({ status: 1 });
