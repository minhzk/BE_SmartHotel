import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability>;

export enum RoomStatus {
  AVAILABLE = 'available',
  BOOKED = 'booked',
  MAINTENANCE = 'maintenance',
}

@Schema({ timestamps: true })
export class RoomAvailability {
  @Prop({ required: true })
  room_id: string;

  @Prop({ required: true })
  date: Date;

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

// Tạo compound index cho room_id và date để tránh trùng lặp
RoomAvailabilitySchema.index({ room_id: 1, date: 1 }, { unique: true });
