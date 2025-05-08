import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { ChatSession, ChatSessionSchema } from './schemas/chat-session.schema';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { AIFeedback, AIFeedbackSchema } from './schemas/ai-feedback.schema';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { HotelsModule } from '../hotels/hotels.module';
import { RoomsModule } from '../rooms/rooms.module';
import { RoomAvailabilityModule } from '../room-availability/room-availability.module';
import { ChatbotDataService } from './chatbot-data.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: AIFeedback.name, schema: AIFeedbackSchema },
    ]),
    ConfigModule,
    HttpModule,
    HotelsModule,
    RoomsModule,
    RoomAvailabilityModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotDataService],
  exports: [ChatbotService],
})
export class ChatbotModule {}
