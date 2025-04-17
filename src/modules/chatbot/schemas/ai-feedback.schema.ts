import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AIFeedbackDocument = HydratedDocument<AIFeedback>;

export enum FeedbackType {
  THUMBS_UP = 'thumbs_up',
  THUMBS_DOWN = 'thumbs_down',
}

@Schema({ timestamps: true })
export class AIFeedback {
  @Prop({ required: true })
  feedback_id: string;

  @Prop()
  user_id: string; // Optional, can be null for non-logged in users

  @Prop({ required: true })
  ai_response_id: string;

  @Prop({ required: true })
  session_id: string;

  @Prop({ type: String, enum: FeedbackType, required: true })
  feedback_type: FeedbackType;

  @Prop()
  feedback_text: string;
}

export const AIFeedbackSchema = SchemaFactory.createForClass(AIFeedback);
AIFeedbackSchema.index({ feedback_id: 1 });
AIFeedbackSchema.index({ ai_response_id: 1 });
AIFeedbackSchema.index({ session_id: 1 });
AIFeedbackSchema.index({ feedback_type: 1 });
