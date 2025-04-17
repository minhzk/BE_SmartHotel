import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

export enum SentimentLabel {
  NEGATIVE = 'Tiêu cực',
  NEUTRAL = 'Trung lập',
  SATISFIED = 'Hài lòng',
  EXCELLENT = 'Tuyệt vời',
  PERFECT = 'Hoàn hảo',
}

class Response {
  @Prop()
  response_text: string;

  @Prop()
  response_by: string;

  @Prop()
  response_date: Date;
}

@Schema({ timestamps: true })
export class Review {
  @Prop({ required: true, unique: true })
  review_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotel_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  user_id: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ min: 0, max: 10 })
  sentiment: number;

  @Prop({ type: String, enum: SentimentLabel })
  sentiment_label: SentimentLabel;

  @Prop({ required: true })
  review_text: string;

  @Prop({ type: Response })
  response: Response;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ hotel_id: 1 });
ReviewSchema.index({ user_id: 1 });
ReviewSchema.index({ rating: 1 });
ReviewSchema.index({ sentiment: 1 });
