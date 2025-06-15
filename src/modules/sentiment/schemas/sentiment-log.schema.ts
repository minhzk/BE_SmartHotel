import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { SentimentLabel } from '../../reviews/schemas/review.schema';

export type SentimentLogDocument = HydratedDocument<SentimentLog>;

@Schema({ timestamps: true })
export class SentimentLog {
  @Prop()
  review_id: string;

  @Prop({ required: true })
  original_text: string;

  @Prop()
  processed_text: string;

  @Prop({ required: true, min: 1, max: 5 })
  sentiment_score: number;

  @Prop({ type: String, enum: SentimentLabel })
  sentiment_label: SentimentLabel;

  @Prop()
  confidence: number;

  @Prop()
  model_version: string;

  @Prop()
  processing_time_ms: number;

  @Prop([String])
  keywords: string[];
}

export const SentimentLogSchema = SchemaFactory.createForClass(SentimentLog);
SentimentLogSchema.index({ review_id: 1 });
SentimentLogSchema.index({ sentiment_score: 1 });
SentimentLogSchema.index({ sentiment_label: 1 });
