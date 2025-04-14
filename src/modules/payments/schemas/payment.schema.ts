import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentType {
  DEPOSIT = 'deposit',
  REMAINING = 'remaining',
  FULL_PAYMENT = 'full_payment',
  WALLET_DEPOSIT = 'wallet_deposit',
}

export enum PaymentMethod {
  VNPAY = 'vnpay',
  WALLET = 'wallet',
  CASH = 'cash',
}

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ required: true, unique: true })
  transaction_id: string; // ID giao dịch riêng của hệ thống

  @Prop({ type: String, required: true })
  booking_id: string; // ID của đặt phòng

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  user_id: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: String, enum: PaymentType, required: true })
  payment_type: PaymentType;

  @Prop({ type: String, enum: PaymentMethod, required: true })
  payment_method: PaymentMethod;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Prop() // URL chuyển hướng sau khi thanh toán
  redirect_url: string;

  @Prop() // URL callback từ VNPay
  ipn_url: string;

  @Prop() // ID giao dịch của VNPay
  vnp_transaction_id: string;

  @Prop() // Mã thanh toán VNPay
  vnp_transaction_no: string;

  @Prop() // Mã ngân hàng
  vnp_bank_code: string;

  @Prop() // Thời gian giao dịch
  payment_date: Date;

  @Prop() // Thông báo lỗi (nếu có)
  error_message: string;

  @Prop({ type: Object }) // Dữ liệu response đầy đủ từ VNPay
  raw_response: Record<string, any>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ transaction_id: 1 }, { unique: true });
PaymentSchema.index({ booking_id: 1 });
PaymentSchema.index({ user_id: 1 });
PaymentSchema.index({ status: 1 });
