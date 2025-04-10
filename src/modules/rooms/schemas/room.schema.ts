import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { BedType } from '../dto/create-room.dto';

export type RoomDocument = HydratedDocument<Room>;

class Image {
  @Prop()
  url: string;

  @Prop()
  description: string;
}

class BedConfiguration {
  @Prop()
  type: string;

  @Prop()
  count: number;
}

@Schema({ timestamps: true })
export class Room {
  @Prop()
  hotel_id: string;

  @Prop()
  room_type: string;

  @Prop()
  price_per_night: number;

  @Prop()
  capacity: number;

  @Prop()
  description: string;

  @Prop([Image])
  images: Image[];

  @Prop([BedConfiguration])
  bed_configuration: BedConfiguration[];

  @Prop([String])
  amenities: string[];

  @Prop()
  size: number;

  @Prop()
  max_adults: number;

  @Prop()
  max_children: number;

  @Prop({ default: true })
  is_active: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
