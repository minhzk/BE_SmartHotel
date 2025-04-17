import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatSession, ChatSessionStatus } from './schemas/chat-session.schema';
import { ChatMessage, SenderType } from './schemas/chat-message.schema';
import { AIFeedback } from './schemas/ai-feedback.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    @InjectModel(ChatSession.name)
    private chatSessionModel: Model<ChatSession>,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessage>,
    @InjectModel(AIFeedback.name)
    private aiFeedbackModel: Model<AIFeedback>,
  ) {}

  async createSession(
    userId: string | undefined,
    createSessionDto: CreateSessionDto,
  ) {
    // Generate unique session ID
    const sessionId = uuidv4();

    // Create initial context
    const context: any = {};
    if (createSessionDto.hotel_id) {
      context.hotel_id = createSessionDto.hotel_id;
    }

    // Create session
    const session = await this.chatSessionModel.create({
      session_id: sessionId,
      user_id: userId,
      start_time: new Date(),
      status: ChatSessionStatus.ACTIVE,
      context,
    });

    // Create welcome message from bot
    const welcomeMessage = await this.chatMessageModel.create({
      session_id: sessionId,
      message_id: uuidv4(),
      sender_type: SenderType.BOT,
      message:
        'Xin chào! Tôi là trợ lý ảo của Smart Hotel. Tôi có thể giúp gì cho bạn về việc đặt phòng hoặc các dịch vụ khác sạn?',
      timestamp: new Date(),
    });

    return {
      session,
      message: welcomeMessage,
    };
  }

  async sendMessage(sendMessageDto: SendMessageDto) {
    const { session_id, message } = sendMessageDto;

    // Check if session exists and is active
    const session = await this.chatSessionModel.findOne({
      session_id,
      status: ChatSessionStatus.ACTIVE,
    });

    if (!session) {
      throw new NotFoundException('Chat session not found or inactive');
    }

    // Create user message
    const userMessage = await this.chatMessageModel.create({
      session_id,
      message_id: uuidv4(),
      sender_type: SenderType.USER,
      message,
      timestamp: new Date(),
    });

    // Process message with chatbot logic
    const botResponse = await this.processChatbotResponse(message, session);

    // Create bot response message
    const botMessage = await this.chatMessageModel.create({
      session_id,
      message_id: uuidv4(),
      sender_type: SenderType.BOT,
      message: botResponse.message,
      intent: botResponse.intent,
      entities: botResponse.entities,
      timestamp: new Date(),
    });

    // Update session context if needed
    if (botResponse.context) {
      await this.chatSessionModel.findByIdAndUpdate(session._id, {
        context: { ...session.context, ...botResponse.context },
      });
    }

    return {
      userMessage,
      botMessage,
    };
  }

  async getChatHistory(sessionId: string, limit: number = 50) {
    // Check if session exists
    const session = await this.chatSessionModel.findOne({
      session_id: sessionId,
    });
    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Get messages for this session
    const messages = await this.chatMessageModel
      .find({ session_id: sessionId })
      .sort({ timestamp: 1 })
      .limit(limit);

    return { session, messages };
  }

  async getUserSessions(userId: string) {
    return await this.chatSessionModel
      .find({ user_id: userId })
      .sort({ start_time: -1 });
  }

  async closeSession(sessionId: string) {
    // Check if session exists
    const session = await this.chatSessionModel.findOne({
      session_id: sessionId,
    });
    if (!session) {
      throw new NotFoundException('Chat session not found');
    }

    // Close the session
    await this.chatSessionModel.findByIdAndUpdate(session._id, {
      status: ChatSessionStatus.CLOSED,
      end_time: new Date(),
    });

    return { success: true, message: 'Session closed successfully' };
  }

  async saveFeedback(feedback: {
    messageId: string;
    sessionId: string;
    feedbackType: string;
    feedbackText?: string;
    userId?: string;
  }) {
    // Check if message exists
    const message = await this.chatMessageModel.findOne({
      message_id: feedback.messageId,
      session_id: feedback.sessionId,
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Create feedback
    const newFeedback = await this.aiFeedbackModel.create({
      feedback_id: uuidv4(),
      user_id: feedback.userId,
      ai_response_id: feedback.messageId,
      session_id: feedback.sessionId,
      feedback_type: feedback.feedbackType,
      feedback_text: feedback.feedbackText,
    });

    return newFeedback;
  }

  private async processChatbotResponse(
    userMessage: string,
    session: ChatSession,
  ): Promise<{
    message: string;
    intent?: string;
    entities?: any[];
    context?: any;
  }> {
    try {
      // In a real application, you would integrate with a proper NLP service
      // like Dialogflow, Rasa, or OpenAI's GPT
      // Here we'll implement a very basic rule-based chatbot

      // Simple intent detection
      const message = userMessage.toLowerCase();
      let intent = 'general';
      let entities = [];
      let responseMessage = '';
      let contextUpdate = {};

      // Simple rule-based responses
      if (
        message.includes('đặt phòng') ||
        message.includes('book') ||
        message.includes('reservation')
      ) {
        intent = 'booking_inquiry';
        responseMessage =
          'Bạn muốn đặt phòng? Vui lòng cho tôi biết ngày nhận phòng, ngày trả phòng và số người.';
        contextUpdate = { booking_intent: true };
      } else if (
        message.includes('giá') ||
        message.includes('price') ||
        message.includes('cost')
      ) {
        intent = 'price_inquiry';
        responseMessage =
          'Giá phòng của chúng tôi thay đổi theo mùa và loại phòng. Bạn đang quan tâm đến loại phòng nào?';
      } else if (
        message.includes('dịch vụ') ||
        message.includes('services') ||
        message.includes('amenities')
      ) {
        intent = 'amenities_inquiry';
        responseMessage =
          'Khách sạn của chúng tôi cung cấp nhiều dịch vụ như bể bơi, phòng gym, spa và nhà hàng. Bạn muốn biết thêm về dịch vụ nào?';
      } else if (message.includes('hủy') || message.includes('cancel')) {
        intent = 'cancellation_inquiry';
        responseMessage =
          'Chính sách hủy phòng của chúng tôi cho phép hủy miễn phí trước 2 ngày so với ngày nhận phòng. Sau thời gian đó, bạn có thể bị tính phí.';
      } else if (message.includes('thank') || message.includes('cảm ơn')) {
        intent = 'thanks';
        responseMessage =
          'Rất vui được giúp bạn! Nếu bạn có thêm câu hỏi, đừng ngại hỏi nhé.';
      } else {
        responseMessage =
          'Xin lỗi, tôi không hiểu câu hỏi của bạn. Bạn có thể nói rõ hơn được không?';
      }

      // Basic entity extraction
      // Extract dates in format DD/MM/YYYY
      const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
      let match;
      while ((match = dateRegex.exec(userMessage)) !== null) {
        const dateStr = match[0];
        entities.push({
          type: 'date',
          value: dateStr,
        });

        // If we have booking intent, try to identify check-in/check-out dates
        if (intent === 'booking_inquiry') {
          if (!contextUpdate['preferred_dates']) {
            contextUpdate['preferred_dates'] = {};
          }

          if (!contextUpdate['preferred_dates']['check_in']) {
            contextUpdate['preferred_dates']['check_in'] = new Date(
              match[3],
              match[2] - 1,
              match[1],
            ); // Format as yyyy-mm-dd
          } else if (!contextUpdate['preferred_dates']['check_out']) {
            contextUpdate['preferred_dates']['check_out'] = new Date(
              match[3],
              match[2] - 1,
              match[1],
            );
          }
        }
      }

      return {
        message: responseMessage,
        intent,
        entities,
        context:
          Object.keys(contextUpdate).length > 0 ? contextUpdate : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Error processing chatbot response: ${error.message}`,
        error.stack,
      );
      return {
        message:
          'Xin lỗi, có lỗi xảy ra khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.',
      };
    }
  }
}
