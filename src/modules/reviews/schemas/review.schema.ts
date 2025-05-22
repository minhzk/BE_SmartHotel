import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

// Label cho sentiment của từng review (1-5)
export enum SentimentLabel {
  VERY_NEGATIVE = 'Rất tiêu cực', // 1
  NEGATIVE = 'Tiêu cực', // 2
  NEUTRAL = 'Trung lập', // 3
  POSITIVE = 'Tích cực', // 4
  VERY_POSITIVE = 'Rất tích cực', // 5
}

// Label cho sentiment trung bình của khách sạn (1-10)
export enum HotelSentimentLabel {
  VERY_BAD = 'Rất tệ', // 1-2
  BAD = 'Tệ', // 3-4
  AVERAGE = 'Trung bình', // 5
  SATISFIED = 'Hài lòng', // 6
  VERY_GOOD = 'Rất tốt', // 7
  EXCELLENT = 'Xuất sắc', // 8
  WONDERFUL = 'Tuyệt vời', // 9
  PERFECT = 'Hoàn hảo', // 10
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
