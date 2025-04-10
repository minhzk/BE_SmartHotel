import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type HotelDocument = HydratedDocument<Hotel>;

class Location {
  @Prop()
  latitude: number;

  @Prop()
  longitude: number;
}

class Image {
  @Prop()
  url: string;

  @Prop()
  description: string;
}

class AISummary {
  @Prop()
  short_description: string;

  @Prop([String])
  highlight_features: string[];

  @Prop()
  average_sentiment: number;

  @Prop()
  last_updated: Date;
}

@Schema({ timestamps: true })
export class Hotel {
  @Prop()
  name: string;

  @Prop()
  address: string;

  @Prop()
  description: string;

  @Prop()
  rating: number;

  @Prop([String])
  amenities: string[];

  @Prop()
  location: Location;

  @Prop([Image])
  images: Image[];

  @Prop({ default: true })
  is_active: boolean;

  @Prop({ default: true })
  accept_deposit: boolean;

  @Prop({ type: Object })
  ai_summary: AISummary;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
