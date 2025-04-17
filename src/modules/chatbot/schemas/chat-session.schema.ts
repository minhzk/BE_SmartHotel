import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatSessionDocument = HydratedDocument<ChatSession>;

export enum ChatSessionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

class PreferredDates {
  @Prop()
  check_in: Date;

  @Prop()
  check_out: Date;
}

class Context {
  @Prop()
  hotel_id: string;

  @Prop({ default: false })
  booking_intent: boolean;

  @Prop({ type: PreferredDates })
  preferred_dates: PreferredDates;
}

@Schema({ timestamps: true })
export class ChatSession {
  @Prop({ required: true, unique: true })
  session_id: string;

  @Prop()
  user_id: string; // Optional - can be null for non-logged in users

  @Prop({ required: true })
  start_time: Date;

  @Prop()
  end_time: Date;

  @Prop({
    type: String,
    enum: ChatSessionStatus,
    default: ChatSessionStatus.ACTIVE,
  })
  status: ChatSessionStatus;

  @Prop({ type: Context, default: {} })
  context: Context;
}

export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);
ChatSessionSchema.index({ user_id: 1 });
ChatSessionSchema.index({ status: 1 });
ChatSessionSchema.index({ start_time: -1 });
