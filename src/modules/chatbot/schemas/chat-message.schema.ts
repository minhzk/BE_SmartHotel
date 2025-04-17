import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

export enum SenderType {
  USER = 'user',
  BOT = 'bot',
}

class Entity {
  @Prop()
  type: string;

  @Prop()
  value: string;
}

@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({ required: true })
  session_id: string;

  @Prop({ required: true })
  message_id: string;

  @Prop({ type: String, enum: SenderType, required: true })
  sender_type: SenderType;

  @Prop({ required: true })
  message: string;

  @Prop()
  intent: string;

  @Prop({ type: [Entity] })
  entities: Entity[];

  @Prop({ required: true })
  timestamp: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ session_id: 1 });
ChatMessageSchema.index({ message_id: 1 });
ChatMessageSchema.index({ timestamp: -1 });
