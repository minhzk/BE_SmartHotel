import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability>;

export enum RoomStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved', // Đã đặt nhưng chưa thanh toán
  BOOKED = 'booked',
  MAINTENANCE = 'maintenance',
}

@Schema({ timestamps: true })
export class RoomAvailability {
  @Prop({ required: true })
  room_id: string;

  @Prop({ required: true })
  start_date: Date;

  @Prop({ required: true })
  end_date: Date;

  @Prop({
    type: String,
    enum: RoomStatus,
    default: RoomStatus.AVAILABLE,
  })
  status: RoomStatus;

  @Prop({ type: Number, default: null })
  price_override: number | null;
}

export const RoomAvailabilitySchema =
  SchemaFactory.createForClass(RoomAvailability);

// Tạo index để tối ưu truy vấn
RoomAvailabilitySchema.index({ room_id: 1, start_date: 1, end_date: 1 });

// Index để tìm kiếm các khoảng ngày chồng chéo nhau
RoomAvailabilitySchema.index({ room_id: 1, start_date: 1 });
RoomAvailabilitySchema.index({ room_id: 1, end_date: 1 });
