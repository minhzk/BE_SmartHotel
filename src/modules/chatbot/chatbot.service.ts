import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChatSession, ChatSessionStatus } from './schemas/chat-session.schema';
import { ChatMessage, SenderType } from './schemas/chat-message.schema';
import { AIFeedback } from './schemas/ai-feedback.schema';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { HotelsService } from '../hotels/hotels.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { ChatbotDataService } from './chatbot-data.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly openaiApiKey: string;
  private readonly openaiModel: string;
  private readonly openaiApiUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(
    @InjectModel(ChatSession.name)
    private chatSessionModel: Model<ChatSession>,
    @InjectModel(ChatMessage.name)
    private chatMessageModel: Model<ChatMessage>,
    @InjectModel(AIFeedback.name)
    private aiFeedbackModel: Model<AIFeedback>,
    private configService: ConfigService,
    private httpService: HttpService,
    @Inject(forwardRef(() => HotelsService))
    private hotelsService: HotelsService,
    @Inject(forwardRef(() => RoomsService))
    private roomsService: RoomsService,
    @Inject(forwardRef(() => RoomAvailabilityService))
    private roomAvailabilityService: RoomAvailabilityService,
    private chatbotDataService: ChatbotDataService,
  ) {
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openaiModel = this.configService.get<string>(
      'OPENAI_MODEL',
      'gpt-3.5-turbo-0125',
    );

    if (!this.openaiApiKey) {
      this.logger.warn('OPENAI_API_KEY not found in environment variables');
    }

    this.logger.log(`Using OpenAI model: ${this.openaiModel}`);
  }

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

    // Add mode to context
    if (createSessionDto.mode) {
      context.mode = createSessionDto.mode;
    }

    // Add capabilities to context
    if (createSessionDto.capabilities) {
      context.capabilities = createSessionDto.capabilities;
    }

    // Add custom system context if provided
    if (createSessionDto.system_context) {
      context.system_context = createSessionDto.system_context;
    }

    // Add user info if provided
    if (createSessionDto.user_info) {
      context.user_info = createSessionDto.user_info;
    }

    // Create session
    const session = await this.chatSessionModel.create({
      session_id: sessionId,
      user_id: userId,
      start_time: new Date(),
      status: ChatSessionStatus.ACTIVE,
      context,
    });

    // Select welcome message based on mode
    let welcomeMessage = '';
    if (context.mode === 'general') {
      welcomeMessage =
        'Xin chào! Tôi là trợ lý AI của Smart Hotel. Tôi có thể cung cấp thông tin về các khách sạn, phòng, giá cả, và giúp bạn tìm kiếm phòng phù hợp. Bạn muốn tìm hiểu điều gì?';
    } else if (context.hotel_id) {
      // Fetch hotel info if hotel_id is provided
      try {
        const hotel = await this.hotelsService.findOne(context.hotel_id);
        welcomeMessage = `Xin chào! Tôi là trợ lý AI của khách sạn ${hotel.name}. Tôi có thể giúp gì cho bạn?`;
      } catch (error) {
        welcomeMessage =
          'Xin chào! Tôi là trợ lý AI của Smart Hotel. Tôi có thể giúp gì cho bạn?';
      }
    } else {
      welcomeMessage =
        'Xin chào! Tôi là trợ lý AI của Smart Hotel. Tôi có thể giúp gì cho bạn?';
    }

    // Create welcome message from bot
    const message = await this.chatMessageModel.create({
      session_id: sessionId,
      message_id: uuidv4(),
      sender_type: SenderType.BOT,
      message: welcomeMessage,
      timestamp: new Date(),
    });

    return {
      session,
      message,
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

    // Process message with OpenAI
    try {
      const response = await this.processOpenAIResponse(message, session);

      // Enhance response with real-time data when needed
      if (
        (session.context as any).mode === 'general' ||
        (session.context as any).capabilities?.hotel_queries
      ) {
        const enhancedResponse = await this.enhanceResponseWithData(
          response,
          session.context,
        );
        response.message = enhancedResponse || response.message;
      }

      // Create bot response message
      const botMessage = await this.chatMessageModel.create({
        session_id,
        message_id: uuidv4(),
        sender_type: SenderType.BOT,
        message: response.message,
        intent: response.intent,
        entities: response.entities,
        timestamp: new Date(),
      });

      // Update session context if needed
      if (response.context) {
        await this.chatSessionModel.findByIdAndUpdate(session._id, {
          context: { ...session.context, ...response.context },
        });
      }

      return {
        userMessage,
        botMessage,
      };
    } catch (error) {
      this.logger.error(
        `Error processing OpenAI response: ${error.message}`,
        error.stack,
      );

      // Fallback response in case of OpenAI API error
      const fallbackMessage =
        'Xin lỗi, hiện tại tôi đang gặp một số vấn đề kỹ thuật. Vui lòng thử lại sau hoặc liên hệ với nhân viên hỗ trợ của chúng tôi.';
      const botMessage = await this.chatMessageModel.create({
        session_id,
        message_id: uuidv4(),
        sender_type: SenderType.BOT,
        message: fallbackMessage,
        timestamp: new Date(),
      });

      return {
        userMessage,
        botMessage,
      };
    }
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

  private async processOpenAIResponse(
    userMessage: string,
    session: ChatSession,
  ): Promise<{
    message: string;
    intent?: string;
    entities?: any[];
    context?: any;
  }> {
    try {
      // Retrieve chat history to provide context
      const chatHistory = await this.chatMessageModel
        .find({ session_id: session.session_id })
        .sort({ timestamp: 1 })
        .limit(10); // Get last 10 messages for context

      // Prepare the conversation history for OpenAI
      const messages = [
        {
          role: 'system',
          content: this.getSystemPrompt(session.context),
        },
      ];

      // Add conversation history
      chatHistory.forEach((msg) => {
        messages.push({
          role: msg.sender_type === SenderType.USER ? 'user' : 'assistant',
          content: msg.message,
        });
      });

      // Add the current user message if it's not already in the history
      if (
        chatHistory.length === 0 ||
        chatHistory[chatHistory.length - 1].sender_type !== SenderType.USER ||
        chatHistory[chatHistory.length - 1].message !== userMessage
      ) {
        messages.push({
          role: 'user',
          content: userMessage,
        });
      }

      // Call OpenAI API
      const response = await firstValueFrom(
        this.httpService.post(
          this.openaiApiUrl,
          {
            model: this.openaiModel, // Use the model from environment variables
            messages,
            temperature: 0.7,
            max_tokens: 500,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.openaiApiKey}`,
            },
          },
        ),
      );

      const assistantMessage = response.data.choices[0].message.content;

      // Extract intent and entities (simplified version)
      let intent = this.extractIntent(userMessage, assistantMessage);
      const entities = this.extractEntities(userMessage);

      // Extract context updates based on the conversation
      const contextUpdate = this.extractContextUpdates(
        userMessage,
        assistantMessage,
        session.context,
      );

      return {
        message: assistantMessage,
        intent,
        entities,
        context:
          Object.keys(contextUpdate).length > 0 ? contextUpdate : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Error processing OpenAI response: ${error.message}`,
        error.stack,
      );

      // Fallback response in case of OpenAI API error
      return {
        message:
          'Xin lỗi, hiện tại tôi đang gặp một số vấn đề kỹ thuật. Vui lòng thử lại sau hoặc liên hệ với nhân viên hỗ trợ của chúng tôi.',
      };
    }
  }

  private async enhanceResponseWithData(
    response: any,
    context: any,
  ): Promise<string | null> {
    try {
      const originalMessage = response.message;
      const intent = response.intent || '';

      // Danh sách khách sạn theo thành phố
      const cityMatch = originalMessage.match(
        /khách sạn (?:ở|tại) ([a-zA-Z\sÀ-ỹ]+)/i,
      );
      if (cityMatch) {
        const city = cityMatch[1].trim();
        const hotels = await this.chatbotDataService.getHotelsByCity(city);

        if (hotels.length > 0) {
          const hotelInfo = hotels
            .map(
              (h) =>
                `- ${h.name}: ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `${originalMessage}\n\nDưới đây là một số khách sạn ở ${city}:\n${hotelInfo}`;
        }
      }

      // Khách sạn đánh giá cao
      if (
        originalMessage.toLowerCase().includes('khách sạn tốt nhất') ||
        originalMessage.toLowerCase().includes('khách sạn đánh giá cao')
      ) {
        const topHotels = await this.chatbotDataService.getTopRatedHotels();

        if (topHotels.length > 0) {
          const hotelInfo = topHotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `${originalMessage}\n\nDưới đây là những khách sạn được đánh giá cao nhất trong hệ thống:\n${hotelInfo}`;
        }
      }

      // Tìm kiếm phòng theo loại
      const roomTypeMatch = originalMessage.match(
        /phòng (standard|deluxe|suite|family|executive)/i,
      );
      if (roomTypeMatch) {
        const roomType = roomTypeMatch[1];
        const rooms =
          await this.chatbotDataService.getRoomsByTypeAndHotel(roomType);

        if (rooms.length > 0) {
          const roomInfo = rooms
            .map(
              (r) =>
                `- ${r.name} tại ${r.hotel_id ? `Khách sạn ${r.hotel_id}` : 'Khách sạn Smart Hotel'}: sức chứa ${r.capacity} người, giá ${r.price_per_night?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `${originalMessage}\n\nTôi đã tìm thấy các phòng loại ${roomType} sau:\n${roomInfo}`;
        }
      }

      // Khách sạn theo khoảng giá
      const priceMatch = originalMessage.match(
        /khách sạn (?:có )?giá (?:từ|khoảng) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))?/i,
      );
      if (priceMatch) {
        let minPrice = parseInt(priceMatch[1], 10) * 1000; // Giả sử giá nhập vào theo nghìn đồng
        let maxPrice = priceMatch[2]
          ? parseInt(priceMatch[2], 10) * 1000
          : minPrice * 3;

        const hotels = await this.chatbotDataService.getHotelsByPriceRange(
          minPrice,
          maxPrice,
        );

        if (hotels.length > 0) {
          const hotelInfo = hotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `${originalMessage}\n\nDưới đây là những khách sạn trong khoảng giá bạn yêu cầu:\n${hotelInfo}`;
        }
      }

      // Kiểm tra tình trạng phòng trống
      const availabilityMatch = originalMessage.match(
        /phòng trống|phòng còn trống|còn phòng|đặt phòng/i,
      );
      if (availabilityMatch) {
        // Trích xuất thông tin về ngày từ ngữ cảnh hoặc tin nhắn
        const dateInfo = this.extractDateInfo(originalMessage, context);

        if (dateInfo.hasValidDates && context?.hotel_id) {
          const availableRooms =
            await this.chatbotDataService.getAvailableRoomsForHotel(
              context.hotel_id,
              dateInfo.checkIn,
              dateInfo.checkOut,
            );

          if (availableRooms.length > 0) {
            const roomInfo = availableRooms
              .map(
                (r) =>
                  `- ${r.name}: loại ${r.room_type}, giá ${r.price_per_night?.toLocaleString()} VND/đêm, còn ${r.available_count} phòng`,
              )
              .join('\n');

            return `${originalMessage}\n\nDưới đây là các phòng còn trống từ ${dateInfo.checkIn} đến ${dateInfo.checkOut}:\n${roomInfo}`;
          } else {
            return `${originalMessage}\n\nRất tiếc, không có phòng trống nào trong khoảng thời gian bạn yêu cầu. Bạn có thể thử chọn ngày khác hoặc khách sạn khác.`;
          }
        } else if (this.needsHotelData(originalMessage)) {
          // Nếu không có ngày cụ thể, cung cấp thông tin tổng quan về khách sạn
          const hotels = await this.chatbotDataService.getTopRatedHotels(3);

          if (hotels.length > 0) {
            const hotelInfo = hotels
              .map(
                (h) =>
                  `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
              )
              .join('\n');

            return `${originalMessage}\n\nTôi cần biết thông tin về ngày check-in và check-out để kiểm tra phòng trống. Trong khi đó, đây là một số khách sạn nổi bật của chúng tôi:\n${hotelInfo}\n\nBạn có thể cho biết thời gian dự kiến đặt phòng không?`;
          }
        }
      }

      // Tìm kiếm thông tin tiện ích
      if (
        originalMessage.toLowerCase().includes('tiện ích') ||
        originalMessage.toLowerCase().includes('dịch vụ') ||
        originalMessage.toLowerCase().includes('amenities')
      ) {
        // Nếu đang nói về một khách sạn cụ thể
        if (context?.hotel_id) {
          const hotelDetails = await this.chatbotDataService.getHotelDetails(
            context.hotel_id,
          );

          if (hotelDetails && hotelDetails.amenities) {
            return `${originalMessage}\n\nKhách sạn ${hotelDetails.name} cung cấp các tiện ích sau:\n- ${hotelDetails.amenities.join('\n- ')}`;
          }
        } else {
          return `${originalMessage}\n\nCác tiện ích phổ biến tại khách sạn của chúng tôi bao gồm:\n- WiFi miễn phí\n- Bữa sáng\n- Hồ bơi\n- Phòng tập gym\n- Dịch vụ đưa đón sân bay\n- Dịch vụ phòng 24/7\n\nMỗi khách sạn có thể có các tiện ích khác nhau. Bạn quan tâm đến khách sạn nào cụ thể?`;
        }
      }

      // Trả lời các câu hỏi về chính sách đặt phòng, hủy phòng
      if (
        originalMessage.toLowerCase().includes('chính sách') ||
        originalMessage.toLowerCase().includes('hủy phòng') ||
        originalMessage.toLowerCase().includes('hoàn tiền')
      ) {
        return `${originalMessage}\n\nChính sách đặt phòng và hủy phòng chung của chúng tôi:\n\n- Đặt cọc: 30% giá trị đặt phòng để đảm bảo việc đặt phòng\n- Hủy miễn phí: Trước 2 ngày so với ngày nhận phòng\n- Hoàn tiền: 100% tiền đặt cọc nếu hủy trong thời hạn miễn phí\n- Check-in: 14:00, Check-out: 12:00\n\nMỗi khách sạn có thể có chính sách riêng. Vui lòng kiểm tra trang chi tiết khách sạn để biết thêm thông tin.`;
      }

      // Nếu user đang hỏi về danh sách khách sạn nói chung
      if (this.needsHotelData(originalMessage)) {
        const hotels = await this.chatbotDataService.getTopRatedHotels(5);

        if (hotels.length > 0) {
          const hotelInfo = hotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `${originalMessage}\n\nDưới đây là một số khách sạn nổi bật trong hệ thống của chúng tôi:\n${hotelInfo}`;
        }
      }

      return null; // Trả về null nếu không cần enhancement
    } catch (error) {
      this.logger.error(`Error enhancing response: ${error.message}`);
      return null;
    }
  }

  // Helper method to extract date information for availability checking
  private extractDateInfo(message: string, context: any) {
    // Try to extract dates from the message
    const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    let dates = [];
    let match;

    while ((match = dateRegex.exec(message)) !== null) {
      dates.push(new Date(match[3], match[2] - 1, match[1]));
    }

    // If we found at least two dates, use them as check-in and check-out
    if (dates.length >= 2) {
      return {
        hasValidDates: true,
        checkIn: dates[0].toISOString().split('T')[0],
        checkOut: dates[1].toISOString().split('T')[0],
      };
    }

    // If only one date found, assume it's check-in and check-out is the next day
    if (dates.length === 1) {
      const checkOut = new Date(dates[0]);
      checkOut.setDate(checkOut.getDate() + 1);

      return {
        hasValidDates: true,
        checkIn: dates[0].toISOString().split('T')[0],
        checkOut: checkOut.toISOString().split('T')[0],
      };
    }

    // Try to get dates from context
    if (
      context?.preferred_dates?.check_in &&
      context?.preferred_dates?.check_out
    ) {
      return {
        hasValidDates: true,
        checkIn: new Date(context.preferred_dates.check_in)
          .toISOString()
          .split('T')[0],
        checkOut: new Date(context.preferred_dates.check_out)
          .toISOString()
          .split('T')[0],
      };
    }

    // No valid dates found
    return {
      hasValidDates: false,
      checkIn: null,
      checkOut: null,
    };
  }

  private needsHotelData(message: string): boolean {
    const triggers = [
      'danh sách khách sạn',
      'có những khách sạn nào',
      'khách sạn ở đâu',
      'có bao nhiêu khách sạn',
      'các khách sạn',
      'khách sạn nào',
    ];
    return triggers.some((t) => message.toLowerCase().includes(t));
  }

  private needsRoomAvailabilityData(message: string, context: any): boolean {
    const triggers = [
      'phòng trống',
      'phòng có sẵn',
      'phòng nào còn trống',
      'đặt phòng',
      'có phòng không',
    ];
    return triggers.some((t) => message.toLowerCase().includes(t));
  }

  private async fetchHotelInformation(): Promise<any[]> {
    try {
      const results = await this.hotelsService.findAll('', 1, 5);
      return results.results || [];
    } catch (error) {
      this.logger.error(`Error fetching hotel information: ${error.message}`);
      return [];
    }
  }

  private getSystemPrompt(context: any): string {
    // Base prompt for all chat scenarios
    let basePrompt = `Bạn là trợ lý AI của Smart Hotel, một hệ thống đặt phòng khách sạn trực tuyến. Bạn sẽ trả lời các câu hỏi của người dùng về các khách sạn, đặt phòng, thanh toán và các dịch vụ liên quan.

THÔNG TIN HỆ THỐNG:
- Smart Hotel có nhiều khách sạn từ 2-5 sao tại các thành phố lớn ở Việt Nam
- Người dùng có thể tìm kiếm, xem thông tin chi tiết và đặt phòng trực tuyến
- Hỗ trợ nhiều phương thức thanh toán: thẻ tín dụng, chuyển khoản, ví điện tử
- Check-in: 14:00, Check-out: 12:00
- Hủy miễn phí trước 2 ngày so với ngày nhận phòng
- Đặt cọc 25% giá trị đặt phòng để đảm bảo đặt phòng thành công
- Các dịch vụ cơ bản: WiFi miễn phí, ăn sáng, dọn phòng hàng ngày`;

    // Add general mode enhancements
    if (context?.mode === 'general') {
      basePrompt += `\n\nBạn đang ở chế độ trợ lý tổng quát, có thể cung cấp thông tin về tất cả khách sạn và phòng trong hệ thống. Người dùng có thể hỏi về:
- Danh sách các khách sạn ở các thành phố cụ thể
- So sánh giá và tiện ích của các khách sạn
- Tìm hiểu về các loại phòng khác nhau
- Kiểm tra tình trạng phòng trống trong một khoảng thời gian
- Chính sách giá, đặt phòng và hủy phòng`;
    }

    // Add hotel-specific information
    if (context?.hotel_id) {
      basePrompt += `\n\nNgười dùng đang quan tâm đến khách sạn cụ thể của chúng tôi. Vui lòng tập trung vào thông tin của khách sạn này.`;
    }

    // Add custom system context if provided
    if (context?.system_context) {
      basePrompt += `\n\n${context.system_context}`;
    }

    // Add user context if available
    if (context?.user_info) {
      basePrompt += `\n\nThông tin người dùng: ${
        context.user_info.name ? `Tên: ${context.user_info.name}.` : ''
      } ${context.user_info.email ? `Email: ${context.user_info.email}.` : ''}`;
    }

    basePrompt += `\n\nHƯỚNG DẪN PHẢN HỒI:
- Trả lời ngắn gọn, lịch sự và chuyên nghiệp bằng Tiếng Việt
- Khi không biết thông tin cụ thể, đề xuất người dùng sử dụng chức năng tìm kiếm hoặc liên hệ trực tiếp
- Không tạo ra thông tin sai lệch về khách sạn hoặc dịch vụ
- Nếu cần thiết, hướng dẫn người dùng đến trang cụ thể để xem thêm thông tin hoặc thực hiện các thao tác`;

    return basePrompt;
  }

  private extractIntent(userMessage: string, assistantMessage: string): string {
    // Simple intent detection logic
    const message = userMessage.toLowerCase();

    if (
      message.includes('đặt phòng') ||
      message.includes('book') ||
      message.includes('reservation')
    ) {
      return 'booking_inquiry';
    }
    if (
      message.includes('giá') ||
      message.includes('price') ||
      message.includes('cost')
    ) {
      return 'price_inquiry';
    }
    if (
      message.includes('dịch vụ') ||
      message.includes('services') ||
      message.includes('amenities')
    ) {
      return 'amenities_inquiry';
    }
    if (message.includes('hủy') || message.includes('cancel')) {
      return 'cancellation_inquiry';
    }
    if (message.includes('thank') || message.includes('cảm ơn')) {
      return 'thanks';
    }

    return 'general';
  }

  private extractEntities(userMessage: string): any[] {
    const entities = [];

    // Extract dates in format DD/MM/YYYY
    const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    let match;
    while ((match = dateRegex.exec(userMessage)) !== null) {
      entities.push({
        type: 'date',
        value: match[0],
      });
    }

    return entities;
  }

  private extractContextUpdates(
    userMessage: string,
    assistantMessage: string,
    currentContext: any,
  ): any {
    const contextUpdate = {};
    const message = userMessage.toLowerCase();

    // Update booking intent
    if (message.includes('đặt phòng') || message.includes('book')) {
      contextUpdate['booking_intent'] = true;
    }

    // Extract dates for booking
    const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    let match;
    let dates = [];

    while ((match = dateRegex.exec(userMessage)) !== null) {
      dates.push(new Date(match[3], match[2] - 1, match[1]));
    }

    if (dates.length > 0) {
      if (!contextUpdate['preferred_dates']) {
        contextUpdate['preferred_dates'] = {};
      }

      if (dates.length >= 1 && !currentContext?.preferred_dates?.check_in) {
        contextUpdate['preferred_dates']['check_in'] = dates[0];
      }

      if (dates.length >= 2 && !currentContext?.preferred_dates?.check_out) {
        contextUpdate['preferred_dates']['check_out'] = dates[1];
      }
    }

    return contextUpdate;
  }
}
