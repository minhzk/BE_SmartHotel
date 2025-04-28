import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BedType, RoomType } from '../dto/create-room.dto';
import mongoose from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

class Image {
  @Prop()
  url: string;

  @Prop()
  description: string;

  @Prop()
  cloudinary_id: string;
}

class BedConfiguration {
  @Prop()
  type: string;

  @Prop()
  count: number;
}

@Schema({ timestamps: true })
export class Room {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' })
  hotel_id: string;

  @Prop({ type: String, enum: RoomType, required: true })
  room_type: string;

  @Prop({ required: true })
  price_per_night: number;

  @Prop({ default: 2 })
  capacity: number;

  @Prop({ required: true })
  description: string;

  @Prop([Image])
  images: Image[];

  @Prop([BedConfiguration])
  bed_configuration: BedConfiguration[];

  @Prop([String])
  amenities: string[];

  @Prop()
  size: number;

  @Prop({ default: 2 })
  max_adults: number;

  @Prop({ default: 0 })
  max_children: number;

  @Prop({ default: 1 })
  number_of_rooms: number;

  // Đổi tên và thêm mô tả để làm rõ ý nghĩa
  @Prop({
    default: true,
    description:
      'Xác định liệu loại phòng này có thể được đặt hay không (khác với tình trạng trống/đã đặt quản lý bởi room-availability)',
  })
  is_bookable: boolean;

  @Prop({ default: true })
  is_active: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

// Thêm các indexes để tăng hiệu suất truy vấn
RoomSchema.index({ hotel_id: 1 });
RoomSchema.index({ room_type: 1 });
RoomSchema.index({ price_per_night: 1 });
RoomSchema.index({ capacity: 1 });
RoomSchema.index({ is_active: 1, is_bookable: 1 });
