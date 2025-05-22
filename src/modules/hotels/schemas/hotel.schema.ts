import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { HotelSentimentLabel } from '../../reviews/schemas/review.schema';

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

  @Prop()
  cloudinary_id: string;
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
  city: string;

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

  @Prop()
  min_price: number;

  @Prop()
  max_price: number;

  @Prop()
  max_capacity: number;

  @Prop()
  sentiment_score: number;

  @Prop({ type: String, enum: HotelSentimentLabel })
  sentiment_label: HotelSentimentLabel;

  @Prop()
  total_reviews: number;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
// Add index for better search performance
HotelSchema.index({ name: 'text', city: 'text' });
HotelSchema.index({ city: 1 });
HotelSchema.index({ min_price: 1, max_price: 1 });
HotelSchema.index({ max_capacity: 1 });
