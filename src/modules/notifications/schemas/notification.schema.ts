import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  BOOKING_CREATED = 'booking_created',
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELED = 'booking_canceled',
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_DUE = 'payment_due',
  CHECK_IN_REMINDER = 'check_in_reminder',
  REVIEW_RECEIVED = 'review_received',
  REVIEW_RESPONSE = 'review_response',
  SYSTEM = 'system',
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  user_id: string;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Object })
  data: Record<string, any>;

  @Prop({ default: false })
  read: boolean;

  @Prop()
  read_at: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ user_id: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ read: 1 });
NotificationSchema.index({ createdAt: -1 });
