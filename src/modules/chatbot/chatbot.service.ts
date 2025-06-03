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

  // Mapping tiện ích từ value sang label tiếng Việt
  private readonly amenityMapping = {
    wifi: 'WiFi',
    pool: 'Hồ bơi',
    gym: 'Phòng gym',
    restaurant: 'Nhà hàng',
    parking: 'Bãi đỗ xe',
    spa: 'Spa',
    ac: 'Điều hòa',
    room_service: 'Dịch vụ phòng',
    business_center: 'Trung tâm thương mại',
    laundry: 'Giặt ủi',
    meeting_room: 'Phòng họp',
    bar: 'Quầy bar',
    breakfast: 'Bữa sáng',
    airport_shuttle: 'Đưa đón sân bay',
    '24h_reception': 'Lễ tân 24h',
    elevator: 'Thang máy',
    smoking_area: 'Khu vực hút thuốc',
    non_smoking_rooms: 'Phòng không hút thuốc',
    kids_club: 'Khu vui chơi trẻ em',
    safety_box: 'Két an toàn',
    medical_service: 'Dịch vụ y tế',
    other: 'Tiện ích khác',
  };

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
        // Truyền thêm message gốc của người dùng vào để phân tích tốt hơn
        const enhancedResponse = await this.enhanceResponseWithData(
          response,
          session.context,
          message, // Truyền thêm userMessage vào
        );

        if (enhancedResponse) {
          if (
            typeof enhancedResponse === 'object' &&
            enhancedResponse.message
          ) {
            response.message = enhancedResponse.message;
            if (enhancedResponse.context) {
              response.context = {
                ...response.context,
                ...enhancedResponse.context,
              };
            }
          } else if (typeof enhancedResponse === 'string') {
            response.message = enhancedResponse;
          }
        }

        console.log('session.context', session.context);
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

      // Update session context if needed or if context was modified during enhancement
      if (
        response.context ||
        JSON.stringify(session.context) !== JSON.stringify(session.context)
      ) {
        const updatedContext = { ...session.context, ...response.context };

        await this.chatSessionModel.findByIdAndUpdate(session._id, {
          context: updatedContext,
        });

        this.logger.log(
          `Updated session context: ${JSON.stringify(updatedContext)}`,
        );
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
    userMessage: string = '',
  ): Promise<{ message: string; context?: any } | string | null> {
    try {
      const originalMessage = response.message;
      const intent = response.intent || '';
      let contextUpdates = {};

      this.logger.log(`Enhancing response for: "${originalMessage}"`);
      if (userMessage) {
        this.logger.log(`Original user message: "${userMessage}"`);
      }

      // Chuẩn hóa chuỗi để tránh lỗi khi so sánh Unicode tiếng Việt
      const normalizedUserMsg = userMessage
        .normalize('NFC') // Chuẩn hóa Unicode
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' '); // Chuẩn hóa khoảng trắng

      // Chuẩn hóa chuỗi để tránh lỗi khi so sánh Unicode tiếng Việt
      const normalizedOriginalMsg = originalMessage
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' '); // Chuẩn hóa khoảng trắng

      // Kiểm tra ngữ cảnh tham chiếu khách sạn ngay từ đầu
      const contextualKeywords = [
        'khách sạn này',
        'ks này',
        'nó',
        'ở đây',
        'chỗ này',
        'của khách sạn',
        'hotel này',
      ];

      const hasContextualReference = contextualKeywords.some((keyword) =>
        normalizedUserMsg.includes(keyword),
      );

      // Nếu có tham chiếu ngữ cảnh, tìm tên khách sạn từ originalMessage
      if (hasContextualReference) {
        this.logger.log(
          `✓ Phát hiện câu hỏi tham chiếu ngữ cảnh: "${userMessage}"`,
        );

        // Kiểm tra xem trong session context có lưu khách sạn nào không
        if (context?.current_hotel) {
          this.logger.log(
            `Sử dụng khách sạn từ context: ${context.current_hotel.name}`,
          );

          try {
            const foundHotel = await this.chatbotDataService.getHotelDetails(
              context.current_hotel.id,
            );

            if (foundHotel) {
              // Phân tích câu hỏi cụ thể về khách sạn từ context
              const contextualResponse = await this.handleSpecificHotelQuestion(
                normalizedUserMsg,
                foundHotel,
              );

              if (contextualResponse) {
                return { message: contextualResponse, context: contextUpdates };
              }
            }
          } catch (error) {
            this.logger.error(
              `Lỗi khi lấy thông tin khách sạn từ context: ${error.message}`,
            );
          }
        }

        // Nếu không có trong context hoặc có lỗi, thì tìm trong originalMessage
        const hotelNamePattern =
          /khách sạn\s*([\p{L}\d\s\-\.]+?)(?:\s+(?:nằm|ở|tại|là|có|được|thuộc|trong|của|như|cung|tọa)|[,.;:!?]|$)/iu;
        const hotelMatch = normalizedOriginalMsg.match(hotelNamePattern);

        let contextHotelName = null;
        if (hotelMatch) {
          contextHotelName = hotelMatch[1]
            .trim()
            .replace(
              /\s+(nằm|ở|o|tại|tai|là|la|có|co|được|thuộc|trong|của)\s*.*$/i,
              '',
            )
            .trim();

          this.logger.log(
            `Tìm thấy tên khách sạn trong ngữ cảnh: "${contextHotelName}"`,
          );

          // Tìm kiếm khách sạn và lưu vào context
          try {
            const hotels =
              await this.chatbotDataService.getHotelsByName(contextHotelName);
            if (hotels.length > 0) {
              const foundHotel = hotels[0];

              // Cập nhật context với thông tin khách sạn
              contextUpdates['current_hotel'] = {
                id: foundHotel._id.toString(),
                name: foundHotel.name,
                city: foundHotel.city,
                rating: foundHotel.rating,
              };

              this.logger.log(
                `Đã cập nhật context với khách sạn: ${foundHotel.name}`,
              );

              // Phân tích câu hỏi cụ thể về khách sạn này
              const contextualResponse = await this.handleSpecificHotelQuestion(
                normalizedUserMsg,
                foundHotel,
              );

              if (contextualResponse) {
                return { message: contextualResponse, context: contextUpdates };
              }
            }
          } catch (error) {
            this.logger.error(
              `Lỗi khi xử lý ngữ cảnh khách sạn: ${error.message}`,
            );
          }
        }
      }

      // Kiểm tra xem user có hỏi về khách sạn cụ thể không (không phải tham chiếu)
      const directHotelPattern =
        /(?:khách sạn|ks|ksan|k san|khach san)\s+(?!được|có|tại|nằm|ở|trong|của|như|là|thuộc|với|và|hoặc|nào|gì|tốt|đánh|giá|cao|chất|lượng|sao|nổi|tiếng|đẹp|sang|top)([\p{L}\d\s\-\.]+?)(?:\s+(?:có|thông tin|chi tiết|giá|địa chỉ|tiện ích|phòng|loại|gì)|[?]|$)/iu;
      const directHotelMatch = normalizedUserMsg.match(directHotelPattern);

      if (directHotelMatch && !hasContextualReference) {
        const hotelName = directHotelMatch[1].trim();
        this.logger.log(
          `✓ Phát hiện câu hỏi về khách sạn cụ thể: "${hotelName}"`,
        );

        try {
          const hotels =
            await this.chatbotDataService.getHotelsByName(hotelName);
          if (hotels.length > 0) {
            const foundHotel = hotels[0];

            // Cập nhật context với thông tin khách sạn mới
            contextUpdates['current_hotel'] = {
              id: foundHotel._id.toString(),
              name: foundHotel.name,
              city: foundHotel.city,
              rating: foundHotel.rating,
            };

            this.logger.log(
              `Đã cập nhật context với khách sạn mới: ${foundHotel.name}`,
            );

            // Phân tích câu hỏi cụ thể về khách sạn này
            const specificResponse = await this.handleSpecificHotelQuestion(
              normalizedUserMsg,
              foundHotel,
            );

            if (specificResponse) {
              return { message: specificResponse, context: contextUpdates };
            }
          } else {
            this.logger.log(`Không tìm thấy khách sạn với tên: "${hotelName}"`);
            return `Xin lỗi, tôi không tìm thấy khách sạn "${hotelName}" trong hệ thống. Bạn có thể kiểm tra lại tên khách sạn hoặc tìm kiếm khách sạn khác?`;
          }
        } catch (error) {
          this.logger.error(`Lỗi khi tìm kiếm khách sạn: ${error.message}`);
        }
      }

      // Tìm kiếm thành phố trong cả userMessage và originalMessage
      let city = null;
      let hotels = [];

      // Danh sách các thành phố được hỗ trợ để đối chiếu kết quả
      const supportedCities = [
        'hồ chí minh',
        'hà nội',
        'đà nẵng',
        'nha trang',
        'phú quốc',
        'hội an',
        'huế',
        'đà lạt',
        'vũng tàu',
        'cần thơ',
        'sapa',
        'quy nhơn',
        'hạ long',
        'phan thiết',
      ];

      // Danh sách các biểu thức chính quy để tìm thành phố
      const cityPatterns = [
        // Pattern 1: Bắt chính xác tên thành phố từ danh sách đã biết
        new RegExp(`\\b(${supportedCities.join('|')})\\b`, 'iu'),

        // Pattern 2: Bắt các biến thể viết tắt của Hồ Chí Minh
        /\b(tp\s*\.?\s*hồ chí minh|tp\s*\.?\s*hcm|hcm|sài gòn)\b/iu,

        // Pattern 3: Tìm trong cấu trúc "khách sạn ở/tại <thành phố>"
        /khách sạn (?:ở|tại|ở tại|của|trong) ([\p{L}\s]+?)(?:[,.;:!?]|$|\s(?:và|hoặc|như|là|thuộc|với|và|hoặc|nào|gì))/iu,
      ];

      // Tìm trong cả userMessage và originalMessage
      const searchTexts = [normalizedUserMsg].filter((text) => text);

      // Thử tìm thành phố trong các message
      for (const text of searchTexts) {
        if (city) break; // Nếu đã tìm thấy rồi thì dừng

        for (let i = 0; i < cityPatterns.length; i++) {
          const pattern = cityPatterns[i];
          const match = text.match(pattern);

          if (match) {
            // Xử lý dựa trên loại pattern
            if (i === 0) {
              // Pattern đầu tiên: Lấy chính xác thành phố từ danh sách đã biết
              city = match[1].trim();
              this.logger.log(
                `Tìm thấy thành phố chính xác: "${city}" trong văn bản (pattern ${i + 1})`,
              );
            } else if (i === 1) {
              // Pattern thứ hai: Chuẩn hóa biến thể của HCM
              city = 'hồ chí minh';
              this.logger.log(
                `Tìm thấy biến thể HCM: "${match[1]}", chuẩn hóa thành "${city}"`,
              );
            } else {
              // Pattern thứ ba: Trích xuất và kiểm tra khớp với thành phố đã biết
              const extractedCity = match[1].trim();

              // Tìm thành phố đã biết gần giống nhất
              const matchedCity = supportedCities.find(
                (c) =>
                  extractedCity.toLowerCase() === c ||
                  extractedCity.toLowerCase().includes(c) ||
                  c.includes(extractedCity.toLowerCase()),
              );

              if (matchedCity) {
                city = matchedCity; // Sử dụng tên chính xác từ danh sách
                this.logger.log(
                  `Tìm thấy thành phố "${city}" (từ "${extractedCity}")`,
                );
              } else {
                // Nếu không khớp với thành phố đã biết, vẫn lấy tên để kiểm tra
                city = extractedCity;
                this.logger.log(
                  `Tìm thấy thành phố không có trong danh sách: "${city}"`,
                );
              }
            }

            // Sau khi xác định được thành phố, tìm khách sạn
            hotels = await this.chatbotDataService.getHotelsByCity(city);
            this.logger.log(`Tìm thấy ${hotels.length} khách sạn ở ${city}`);
            break;
          }
        }
      }

      // Nếu tìm thấy thành phố và có khách sạn
      if (city && hotels.length > 0) {
        const hotelInfo = hotels
          .map(
            (h) =>
              `- ${h.name}: ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
          )
          .join('\n');

        // Tạo phản hồi hoàn toàn mới thay vì nối thêm vào originalMessage
        return `Dưới đây là một số khách sạn ở ${city}:\n${hotelInfo}\n\nBạn muốn biết thêm thông tin về khách sạn nào không?`;
      }

      // Khách sạn đánh giá cao - Cải tiến nhận diện với chuẩn hóa chuỗi
      // Tạo các pattern và chuỗi để kiểm tra
      const hotelKeywords = ['khách sạn', 'ks', 'hotel'];
      const ratingKeywords = [
        'tốt',
        'cao',
        'đánh giá cao',
        'chất lượng',
        '5 sao',
        'nổi tiếng',
        'đẹp',
        'sang trọng',
        'top',
      ];

      // Kiểm tra từng pattern riêng biệt
      const hasHotelKeyword = hotelKeywords.some((keyword) =>
        normalizedUserMsg.includes(keyword),
      );
      const hasRatingKeyword = ratingKeywords.some((keyword) =>
        normalizedUserMsg.includes(keyword),
      );

      // Log kết quả kiểm tra trung gian
      this.logger.log(`normalizedUserMsg: "${normalizedUserMsg}"`);
      this.logger.log(
        `hasHotelKeyword: ${hasHotelKeyword}, hasRatingKeyword: ${hasRatingKeyword}`,
      );

      // Sử dụng biểu thức chính quy với cờ u (unicode)
      const bestHotelPattern =
        /(khách sạn|ks).*?(tốt|cao|đánh giá|chất lượng|sao|nổi tiếng|nổi bật|sang|sang trọng|top|đẹp)/iu;
      const isPatternMatch = bestHotelPattern.test(normalizedUserMsg);

      if (
        isPatternMatch ||
        (hasHotelKeyword && hasRatingKeyword) ||
        // Giữ lại các điều kiện hiện có như một backup
        normalizedUserMsg.includes('khách sạn tốt') ||
        normalizedUserMsg.includes('khách sạn đánh giá cao') ||
        normalizedUserMsg.includes('khách sạn đẹp') ||
        normalizedUserMsg.includes('khách sạn nổi tiếng') ||
        normalizedUserMsg.includes('khách sạn 5 sao') ||
        normalizedUserMsg.includes('khách sạn sang') ||
        // Vẫn giữ lại đoạn code kiểm tra originalMessage như một phương án dự phòng
        (originalMessage &&
          originalMessage.toLowerCase().includes('khách sạn') &&
          (originalMessage.toLowerCase().includes('đánh giá cao') ||
            originalMessage.toLowerCase().includes('tốt nhất')))
      ) {
        this.logger.log(`✓ Phát hiện yêu cầu về khách sạn đánh giá cao`);
        const topHotels = await this.chatbotDataService.getTopRatedHotels();
        this.logger.log(`Tìm thấy ${topHotels.length} khách sạn đánh giá cao`);

        if (topHotels.length > 0) {
          const hotelInfo = topHotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          // Tạo phản hồi hoàn toàn mới
          return `Dưới đây là những khách sạn được đánh giá cao nhất trong hệ thống:\n${hotelInfo}\n\nBạn muốn xem thêm thông tin chi tiết về khách sạn nào không?`;
        } else {
          this.logger.log(`Không tìm thấy dữ liệu khách sạn đánh giá cao`);
        }
      }

      // Tìm kiếm phòng theo loại - Cải tiến để hỗ trợ tất cả RoomType
      const roomTypeKeywords = {
        standard: 'Standard',
        'tiêu chuẩn': 'Standard',
        deluxe: 'Deluxe',
        'sang trọng': 'Deluxe',
        suite: 'Suite',
        'phòng suite': 'Suite',
        executive: 'Executive',
        'hạng sang': 'Executive',
        family: 'Family',
        'gia đình': 'Family',
        villa: 'Villa',
        'biệt thự': 'Villa',
        bungalow: 'Bungalow',
        'nhà vườn': 'Bungalow',
        studio: 'Studio',
        connecting: 'Connecting',
        'liên thông': 'Connecting',
        accessible: 'Accessible',
        'tiếp cận': 'Accessible',
        penthouse: 'Penthouse',
        'áp mái': 'Penthouse',
        presidential: 'Presidential',
        'tổng thống': 'Presidential',
      };

      // Log để debug các từ khóa loại phòng
      this.logger.log(`Kiểm tra loại phòng trong message: ${userMessage}`);

      // Kiểm tra trực tiếp từng loại phòng trong message
      let roomTypeFound = null;
      let matchedKeyword = null;

      // Tìm từ khóa loại phòng trong message
      for (const keyword of Object.keys(roomTypeKeywords)) {
        if (userMessage.toLowerCase().includes(keyword.toLowerCase())) {
          matchedKeyword = keyword.toLowerCase();
          roomTypeFound = roomTypeKeywords[matchedKeyword];
          this.logger.log(
            `Tìm thấy từ khóa trực tiếp: "${matchedKeyword}" -> ${roomTypeFound}`,
          );
          break;
        }
      }

      // Nếu không tìm thấy bằng cách trên, thử dùng regex
      if (!roomTypeFound) {
        // Mẫu regex linh hoạt hơn, bắt nhiều dạng câu khác nhau
        const roomTypePattern = new RegExp(
          `phòng(?:\\s+|\\s+loại\\s+|\\s+kiểu\\s+|\\s+dạng\\s+)(${Object.keys(roomTypeKeywords).join('|')})`,
          'i',
        );
        const roomTypeMatch = userMessage.match(roomTypePattern);

        if (roomTypeMatch) {
          matchedKeyword = roomTypeMatch[1].toLowerCase();
          roomTypeFound = roomTypeKeywords[matchedKeyword];
          this.logger.log(
            `Tìm thấy qua regex: "${matchedKeyword}" -> ${roomTypeFound}`,
          );
        }
      }

      if (roomTypeFound) {
        this.logger.log(
          `Xử lý yêu cầu về phòng loại ${roomTypeFound} (từ khóa: ${matchedKeyword})`,
        );

        const rooms =
          await this.chatbotDataService.getRoomsByTypeAndHotel(roomTypeFound);
        this.logger.log(`Tìm thấy ${rooms.length} phòng loại ${roomTypeFound}`);

        if (rooms.length > 0) {
          // Lấy danh sách hotel_id độc đáo từ các phòng
          const uniqueHotelIds = [
            ...new Set(rooms.map((r) => r.hotel_id).filter((id) => id)),
          ];
          const hotelNames = new Map(); // Map để lưu trữ hotel_id -> hotel_name

          // Lấy thông tin các khách sạn
          for (const hotelId of uniqueHotelIds) {
            try {
              const hotel =
                await this.chatbotDataService.getHotelDetails(hotelId);
              if (hotel && hotel.name) {
                hotelNames.set(hotelId, hotel.name);
              }
            } catch (error) {
              this.logger.error(
                `Không thể lấy thông tin khách sạn ${hotelId}: ${error.message}`,
              );
            }
          }

          // Tạo thông tin phòng với tên khách sạn thay vì ID
          const roomInfo = rooms
            .map((r) => {
              const hotelName = r.hotel_id
                ? hotelNames.get(r.hotel_id) || `Khách sạn ${r.hotel_id}` // Sử dụng tên nếu có, nếu không thì dùng ID
                : 'Khách sạn Smart Hotel';

              return `- ${r.name} tại ${hotelName}: sức chứa ${r.capacity} người, giá ${r.price_per_night?.toLocaleString()} VND/đêm`;
            })
            .join('\n');

          return `Tôi đã tìm thấy các phòng loại ${roomTypeFound} sau:\n${roomInfo}\n\nBạn có quan tâm đến phòng nào không?`;
        } else {
          return `Hiện tại chúng tôi không có phòng loại ${roomTypeFound} nào khả dụng. Bạn có thể quan tâm đến các loại phòng khác như Standard, Deluxe hoặc Suite không?`;
        }
      }

      // Xử lý trường hợp người dùng hỏi về "các loại phòng" - sử dụng chuỗi đã chuẩn hóa
      // Chuỗi đã được chuẩn hóa từ trước (từ phần xử lý khách sạn đánh giá cao)
      // Nếu chưa có thì chuẩn hóa lại

      // Các từ khóa và cụm từ liên quan đến câu hỏi về loại phòng
      const roomPhrases = ['loại phòng', 'các phòng', 'phòng gì'];
      const questionPhrases = [
        'có',
        'hiện có',
        'cung cấp',
        'cho biết',
        'liệt kê',
      ];

      // Các từ khóa liên quan đến phòng trống/tình trạng phòng
      const availabilityKeywords = [
        'trống',
        'còn trống',
        'có sẵn',
        'sẵn có',
        'available',
        'còn',
        'đặt được',
        'book được',
        'free',
        'vacant',
        'tình trạng',
        'status',
      ];

      // Kiểm tra từng điều kiện riêng biệt
      const hasRoomTypeKeyword = roomPhrases.some((phrase) =>
        normalizedUserMsg.includes(phrase),
      );
      const hasQuestionKeyword = questionPhrases.some((phrase) =>
        normalizedUserMsg.includes(phrase),
      );

      // Kiểm tra xem có phải câu hỏi về phòng trống không
      const hasAvailabilityKeyword = availabilityKeywords.some((keyword) =>
        normalizedUserMsg.includes(keyword),
      );

      // Kiểm tra bằng regex linh hoạt
      const roomTypesQuestionPattern =
        /(?:có|cho\s+biết|liệt\s+kê|kể|nêu|hiển\s+thị)?\s*(?:các|những)?\s*(?:loại|kiểu|dạng|hạng)?\s*phòng\s*(?:gì|nào|như\s+thế\s+nào|ra\s+sao|ở\s+đây|của\s+(?:smart\s+hotel|khách\s+sạn))?/i;

      const isPatternRoomTypeMatch =
        roomTypesQuestionPattern.test(normalizedUserMsg);

      this.logger.log(`Kiểm tra câu hỏi về loại phòng: "${normalizedUserMsg}"`);
      this.logger.log(
        `hasRoomTypeKeyword: ${hasRoomTypeKeyword}, hasQuestionKeyword: ${hasQuestionKeyword}, hasAvailabilityKeyword: ${hasAvailabilityKeyword}, isPatternMatch: ${isPatternRoomTypeMatch}`,
      );

      if (
        !hasAvailabilityKeyword && // Thêm điều kiện loại trừ phòng trống
        (isPatternRoomTypeMatch ||
          (hasRoomTypeKeyword && hasQuestionKeyword) ||
          // Hardcode các trường hợp đặc biệt để đảm bảo bắt được
          normalizedUserMsg === 'có các loại phòng nào' ||
          normalizedUserMsg === 'có những loại phòng nào' ||
          normalizedUserMsg === 'có các phòng gì' ||
          normalizedUserMsg === 'có phòng gì' ||
          normalizedUserMsg.includes('các loại phòng') ||
          normalizedUserMsg.includes('loại phòng nào'))
      ) {
        this.logger.log(
          `✓ Phát hiện câu hỏi về danh sách loại phòng: "${userMessage}"`,
        );

        // Kiểm tra xem có context về khách sạn cụ thể không
        if (context?.current_hotel) {
          this.logger.log(
            `Trả lời loại phòng cho khách sạn cụ thể: ${context.current_hotel.name}`,
          );

          try {
            const rooms = await this.chatbotDataService.getHotelRooms(
              context.current_hotel.id,
            );

            if (rooms.length > 0) {
              const roomInfo = rooms
                .map(
                  (r) =>
                    `- ${r.name} (${r.room_type}): sức chứa ${r.capacity} người, giá ${r.price_per_night?.toLocaleString()} VND/đêm`,
                )
                .join('\n');

              return `Khách sạn ${context.current_hotel.name} có các loại phòng sau:\n${roomInfo}\n\nBạn muốn biết thêm thông tin chi tiết về loại phòng nào không?`;
            } else {
              return `Hiện tại khách sạn ${context.current_hotel.name} chưa có thông tin về các loại phòng. Vui lòng liên hệ trực tiếp với khách sạn để biết thêm chi tiết.`;
            }
          } catch (error) {
            this.logger.error(
              `Lỗi khi lấy thông tin phòng cho khách sạn ${context.current_hotel.name}: ${error.message}`,
            );
            // Fallback về thông tin tổng quát
          }
        }

        const roomTypes = Object.values(roomTypeKeywords).filter(
          (value, index, self) => self.indexOf(value) === index,
        );

        // Tạo phản hồi chi tiết hơn
        let response = `Smart Hotel cung cấp các loại phòng sau:\n- ${roomTypes.join('\n- ')}\n\n`;

        // Thêm mô tả tóm tắt cho các loại phòng phổ biến
        response += `Một số thông tin về các loại phòng phổ biến:\n`;
        response += `• Standard: Phòng tiêu chuẩn, trang bị cơ bản, giá cả hợp lý\n`;
        response += `• Deluxe: Phòng cao cấp hơn, rộng rãi và tiện nghi hơn Standard\n`;
        response += `• Suite: Phòng sang trọng với không gian riêng biệt gồm phòng khách và phòng ngủ\n`;
        response += `• Family: Phòng thiết kế dành cho gia đình, thường có nhiều giường và không gian rộng rãi\n`;
        response += `• Executive: Phòng hạng sang với dịch vụ đặc biệt và quyền lợi thêm\n\n`;

        response += `Bạn muốn tìm hiểu thêm về loại phòng nào hoặc có nhu cầu đặc biệt nào không?`;

        return response;
      }

      // Khách sạn theo khoảng giá - Tìm kiếm trong cả userMessage và originalMessage
      let priceMatch = null;

      // Kiểm tra nếu đang có context về khách sạn cụ thể và hỏi về giá
      if (
        context?.current_hotel &&
        (normalizedUserMsg.includes('giá') ||
          normalizedUserMsg.includes('bao nhiêu') ||
          normalizedUserMsg.includes('cost') ||
          normalizedUserMsg.includes('price')) &&
        // Loại trừ các trường hợp hỏi về giá khách sạn chung
        !normalizedUserMsg.includes('khách sạn') &&
        !normalizedUserMsg.includes('hotel') &&
        !normalizedUserMsg.includes('ks') &&
        !normalizedUserMsg.includes('ksan')
      ) {
        this.logger.log(
          `✓ Phát hiện câu hỏi về giá trong context khách sạn: ${context.current_hotel.name}`,
        );

        try {
          const hotelDetails = await this.chatbotDataService.getHotelDetails(
            context.current_hotel.id,
          );

          if (hotelDetails) {
            const rooms = await this.chatbotDataService.getHotelRooms(
              context.current_hotel.id,
            );

            if (rooms.length > 0) {
              const roomInfo = rooms
                .map(
                  (r) =>
                    `- ${r.name}: ${r.price_per_night?.toLocaleString()} VND/đêm`,
                )
                .join('\n');

              return `Bảng giá phòng tại khách sạn ${hotelDetails.name}:\n${roomInfo}`;
            }
          }
        } catch (error) {
          this.logger.error(
            `Lỗi khi lấy giá phòng từ context: ${error.message}`,
          );
        }
      }

      // Tìm kiếm trong cả hai nguồn tin nhắn với nhiều pattern khác nhau
      for (const text of searchTexts) {
        // Pattern 1: "khách sạn có giá từ X"
        let match = text.match(
          /khách sạn (?:có )?(?:mức )?giá (?:từ|khoảng|cả) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))?/i,
        );

        // Pattern 2: "các khách sạn có mức giá từ X"
        if (!match) {
          match = text.match(
            /(?:các|những) khách sạn (?:có|với) (?:mức )?giá (?:từ|khoảng|cả) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))?/i,
          );
        }

        // Pattern 3: "khách sạn giá từ X"
        if (!match) {
          match = text.match(
            /khách sạn (?:mức )?giá (?:từ|khoảng|cả) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))?/i,
          );
        }

        // Pattern 4: "tìm khách sạn giá từ X"
        if (!match) {
          match = text.match(
            /(?:tìm|tìm kiếm|cần|muốn) (?:các |những )?khách sạn (?:có )?(?:mức )?giá (?:từ|khoảng|cả) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))?/i,
          );
        }

        // Pattern 5: "giá từ X khách sạn"
        if (!match) {
          match = text.match(
            /(?:mức )?giá (?:từ|khoảng|cả) (\d+)(?:\s*(?:đến|tới|-)?\s*(\d+))? (?:các |những )?khách sạn/i,
          );
        }

        if (match) {
          priceMatch = match;
          this.logger.log(
            `Tìm thấy thông tin khoảng giá trong: "${text.substring(0, 50)}..."`,
          );
          break;
        }
      }

      // Nếu có thông tin khoảng giá, tìm khách sạn theo khoảng giá
      if (priceMatch) {
        // Thông minh hơn khi xử lý giá - tự động phát hiện đơn vị
        let minPrice = parseInt(priceMatch[1], 10);
        let maxPrice = priceMatch[2] ? parseInt(priceMatch[2], 10) : null;

        // Kiểm tra nếu giá nhỏ (người dùng nhập theo đơn vị nghìn đồng)
        if (minPrice < 10000) {
          minPrice *= 1000; // Chuyển đơn vị nghìn đồng sang đồng
          if (maxPrice && maxPrice < 10000) {
            maxPrice *= 1000; // Chuyển đơn vị nghìn đồng sang đồng
          }
        }

        this.logger.log(
          maxPrice
            ? `✓ Phát hiện yêu cầu tìm khách sạn theo khoảng giá: ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()} VND`
            : `✓ Phát hiện yêu cầu tìm khách sạn giá từ: ${minPrice.toLocaleString()} VND trở lên`,
        );

        const hotels = await this.chatbotDataService.getHotelsByPriceRange(
          minPrice,
          maxPrice,
        );

        this.logger.log(
          maxPrice
            ? `Tìm thấy ${hotels.length} khách sạn trong khoảng giá ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()} VND`
            : `Tìm thấy ${hotels.length} khách sạn từ ${minPrice.toLocaleString()} VND trở lên`,
        );

        if (hotels.length > 0) {
          const hotelInfo = hotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          const priceRangeText = maxPrice
            ? `trong khoảng giá ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()} VND`
            : `từ ${minPrice.toLocaleString()} VND trở lên`;

          return `Dưới đây là top 5 khách sạn có giá ${priceRangeText}:\n${hotelInfo}`;
        }
      }

      // Kiểm tra tình trạng phòng trống
      const availabilityMatch = normalizedUserMsg.match(
        /phòng trống|phòng còn trống|còn phòng|đặt phòng/i,
      );
      if (availabilityMatch) {
        // Trích xuất thông tin về ngày từ ngữ cảnh hoặc tin nhắn
        const dateInfo = this.extractDateInfo(
          normalizedUserMsg,
          context.current_hotel,
        );

        if (dateInfo.hasValidDates && context?.current_hotel?.id) {
          const availableRooms =
            await this.chatbotDataService.getAvailableRoomsForHotel(
              context.current_hotel.id,
              dateInfo.checkIn,
              dateInfo.checkOut,
            );

          this.logger.log(
            `Tìm thấy ${availableRooms.length} phòng trống tại khách sạn ${context.current_hotel.name} từ ${dateInfo.checkIn} đến ${dateInfo.checkOut}`,
          );

          if (availableRooms.length > 0) {
            const roomInfo = availableRooms
              .map(
                (r) =>
                  `- ${r.name || r._doc?.name}: loại ${r.room_type || r._doc?.room_type}, giá ${(r.price_per_night || r._doc?.price_per_night)?.toLocaleString()} VND/đêm, còn ${r.available_count} phòng`,
              )
              .join('\n');

            return `Dưới đây là các phòng còn trống từ ${dateInfo.checkIn} đến ${dateInfo.checkOut}:\n${roomInfo}`;
          } else {
            return `Rất tiếc, không có phòng trống nào trong khoảng thời gian bạn yêu cầu. Bạn có thể thử chọn ngày khác hoặc khách sạn khác.`;
          }
        } else if (this.needsHotelData(userMessage)) {
          // Nếu không có ngày cụ thể, cung cấp thông tin tổng quan về khách sạn
          const hotels = await this.chatbotDataService.getTopRatedHotels(3);

          if (hotels.length > 0) {
            const hotelInfo = hotels
              .map(
                (h) =>
                  `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
              )
              .join('\n');

            return `Tôi cần biết thông tin về ngày check-in và check-out để kiểm tra phòng trống. Trong khi đó, đây là một số khách sạn nổi bật của chúng tôi:\n${hotelInfo}\n\nBạn có thể cho biết thời gian dự kiến đặt phòng không?`;
          }
        }
      }

      // Tìm kiếm thông tin tiện ích
      if (
        normalizedUserMsg.toLowerCase().includes('tiện ích') ||
        normalizedUserMsg.toLowerCase().includes('dịch vụ') ||
        normalizedUserMsg.toLowerCase().includes('amenities')
      ) {
        // Nếu đang nói về một khách sạn cụ thể
        if (context?.current_hotel) {
          const hotelDetails = await this.chatbotDataService.getHotelDetails(
            context.current_hotel.id,
          );

          if (hotelDetails && hotelDetails.amenities) {
            const formattedAmenities = this.formatAmenities(
              hotelDetails.amenities,
            );
            return `Khách sạn ${hotelDetails.name} cung cấp các tiện ích sau:\n- ${formattedAmenities.join('\n- ')}`;
          }
        } else {
          return `Các tiện ích phổ biến tại khách sạn của chúng tôi bao gồm:\n- WiFi miễn phí\n- Bữa sáng\n- Hồ bơi\n- Phòng tập gym\n- Dịch vụ đưa đón sân bay\n- Dịch vụ phòng 24/7\n\nMỗi khách sạn có thể có các tiện ích khác nhau. Bạn quan tâm đến khách sạn nào cụ thể?`;
        }
      }

      // Trả lời các câu hỏi về chính sách đặt phòng, hủy phòng
      if (
        normalizedUserMsg.toLowerCase().includes('chính sách') ||
        normalizedUserMsg.toLowerCase().includes('hủy phòng') ||
        normalizedUserMsg.toLowerCase().includes('hoàn tiền')
      ) {
        return `Chính sách đặt phòng và hủy phòng chung của chúng tôi:\n\n- Đặt cọc: 30% giá trị đặt phòng để đảm bảo việc đặt phòng\n- Hủy miễn phí: Trước 2 ngày so với ngày nhận phòng\n- Hoàn tiền: 100% tiền đặt cọc nếu hủy trong thời hạn miễn phí\n- Check-in: 14:00, Check-out: 12:00\n\nMỗi khách sạn có thể có chính sách riêng. Vui lòng kiểm tra trang chi tiết khách sạn để biết thêm thông tin.`;
      }

      // Nếu user đang hỏi về danh sách khách sạn nói chung
      if (this.needsHotelData(normalizedUserMsg)) {
        const hotels = await this.chatbotDataService.getTopRatedHotels(5);

        if (hotels.length > 0) {
          const hotelInfo = hotels
            .map(
              (h) =>
                `- ${h.name} (${h.city}): ${h.rating} sao, từ ${h.min_price?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `Dưới đây là một số khách sạn nổi bật trong hệ thống của chúng tôi:\n${hotelInfo}`;
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
    this.logger.log(
      `Extracting date information from message: "${message}" with context: ${JSON.stringify(context)}`,
    );

    let dates = [];
    const currentYear = new Date().getFullYear();

    // Pattern 1: Full date format DD/MM/YYYY - highest priority
    const fullDateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    let match;
    while ((match = fullDateRegex.exec(message)) !== null) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]);
      const year = parseInt(match[3]);
      if (day <= 31 && month <= 12) {
        const date = new Date(year, month - 1, day); // month - 1 because JS months are 0-indexed
        dates.push(date);
        this.logger.log(
          `Found full date: ${day}/${month}/${year} -> Created date: ${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
        );
      }
    }

    // Pattern 2: Vietnamese format "ngày X tháng Y" - second priority
    const vietnameseDateRegex =
      /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/gi;
    while ((match = vietnameseDateRegex.exec(message)) !== null) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]);
      const year = match[3] ? parseInt(match[3]) : currentYear;
      if (day <= 31 && month <= 12) {
        const date = new Date(year, month - 1, day);
        dates.push(date);
        this.logger.log(
          `Found Vietnamese date: ngày ${day} tháng ${month} -> Created date: ${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
        );
      }
    }

    // Only process short formats if no full dates were found
    if (dates.length === 0) {
      // Pattern 3: Short date format DD/MM (assume current year) - Vietnamese format is always DD/MM
      const shortDateRegex = /(?<![\d\/])(\d{1,2})\/(\d{1,2})(?![\d\/])/g;
      while ((match = shortDateRegex.exec(message)) !== null) {
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);

        // In Vietnamese context, always treat as DD/MM format
        if (day <= 31 && month <= 12) {
          const date = new Date(currentYear, month - 1, day); // month - 1 for 0-indexed months
          dates.push(date);
          this.logger.log(
            `Found short date (DD/MM): ${day}/${month} -> Created date: ${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
          );
        }
      }

      // Pattern 4: Dash format DD-MM (assume current year)
      const dashDateRegex = /(?<![\d\-])(\d{1,2})-(\d{1,2})(?![\d\-])/g;
      while ((match = dashDateRegex.exec(message)) !== null) {
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        if (day <= 31 && month <= 12) {
          const date = new Date(currentYear, month - 1, day);
          dates.push(date);
          this.logger.log(
            `Found dash date (DD-MM): ${day}-${month} -> Created date: ${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`,
          );
        }
      }
    }

    // Sort dates chronologically
    dates.sort((a, b) => a.getTime() - b.getTime());

    // Remove duplicates
    dates = dates.filter(
      (date, index, self) =>
        index ===
        self.findIndex((d) => d.toDateString() === date.toDateString()),
    );

    // Log dates with proper formatting
    this.logger.log(
      `Extracted dates: ${dates
        .map((d) => {
          const year = d.getFullYear();
          const month = (d.getMonth() + 1).toString().padStart(2, '0');
          const day = d.getDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        })
        .join(', ')}`,
    );

    // If we found at least two dates, use them as check-in and check-out
    if (dates.length >= 2) {
      const checkInDate = dates[0];
      const checkOutDate = dates[1];

      const checkIn = `${checkInDate.getFullYear()}-${(checkInDate.getMonth() + 1).toString().padStart(2, '0')}-${checkInDate.getDate().toString().padStart(2, '0')}`;
      const checkOut = `${checkOutDate.getFullYear()}-${(checkOutDate.getMonth() + 1).toString().padStart(2, '0')}-${checkOutDate.getDate().toString().padStart(2, '0')}`;

      this.logger.log(
        `Returning dates: checkIn=${checkIn}, checkOut=${checkOut}`,
      );

      return {
        hasValidDates: true,
        checkIn,
        checkOut,
      };
    }

    // If only one date found, assume it's check-in and check-out is the next day
    if (dates.length === 1) {
      const checkInDate = dates[0];
      const checkOutDate = new Date(checkInDate);
      checkOutDate.setDate(checkOutDate.getDate() + 1);

      const checkIn = `${checkInDate.getFullYear()}-${(checkInDate.getMonth() + 1).toString().padStart(2, '0')}-${checkInDate.getDate().toString().padStart(2, '0')}`;
      const checkOut = `${checkOutDate.getFullYear()}-${(checkOutDate.getMonth() + 1).toString().padStart(2, '0')}-${checkOutDate.getDate().toString().padStart(2, '0')}`;

      this.logger.log(
        `Returning single date extended: checkIn=${checkIn}, checkOut=${checkOut}`,
      );

      return {
        hasValidDates: true,
        checkIn,
        checkOut,
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

    // If no specific dates mentioned, use current date as check-in and next day as check-out
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const checkIn = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    const checkOut = `${tomorrow.getFullYear()}-${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getDate().toString().padStart(2, '0')}`;

    this.logger.log(
      `Using default dates: checkIn=${checkIn}, checkOut=${checkOut}`,
    );

    return {
      hasValidDates: true,
      checkIn,
      checkOut,
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
    if (context?.current_hotel) {
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

  // Phương thức chuyển đổi danh sách tiện ích
  private formatAmenities(amenities: string[]): string[] {
    return amenities.map((amenity) => this.amenityMapping[amenity] || amenity);
  }

  // Phương thức mới để xử lý câu hỏi cụ thể về khách sạn đã xác định
  private async handleSpecificHotelQuestion(
    normalizedUserMsg: string,
    hotel: any,
  ): Promise<string | null> {
    // Trả lời về giá phòng
    if (
      normalizedUserMsg.includes('giá') ||
      normalizedUserMsg.includes('bao nhiêu')
    ) {
      try {
        const rooms = await this.chatbotDataService.getHotelRooms(
          hotel._id.toString(),
        );
        if (rooms.length > 0) {
          const roomInfo = rooms
            .map(
              (r) =>
                `- ${r.name}: ${r.price_per_night?.toLocaleString()} VND/đêm`,
            )
            .join('\n');

          return `Bảng giá phòng tại khách sạn ${hotel.name}:\n${roomInfo}`;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi lấy giá phòng: ${error.message}`);
      }
    }

    // Trả lời về địa chỉ/vị trí
    if (
      normalizedUserMsg.includes('địa chỉ') ||
      normalizedUserMsg.includes('ở đâu') ||
      normalizedUserMsg.includes('vị trí')
    ) {
      return `Khách sạn ${hotel.name} tọa lạc tại ${hotel.address || hotel.city}`;
    }

    // Trả lời về tiện ích
    if (
      normalizedUserMsg.includes('tiện ích') ||
      normalizedUserMsg.includes('dịch vụ')
    ) {
      try {
        const hotelDetails = await this.chatbotDataService.getHotelDetails(
          hotel._id.toString(),
        );
        if (hotelDetails && hotelDetails.amenities) {
          const formattedAmenities = this.formatAmenities(
            hotelDetails.amenities,
          );
          return `Khách sạn ${hotel.name} cung cấp các tiện ích sau:\n- ${formattedAmenities.join('\n- ')}`;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi lấy tiện ích: ${error.message}`);
      }
    }

    // Trả lời về loại phòng
    if (
      normalizedUserMsg.includes('loại phòng') ||
      normalizedUserMsg.includes('phòng gì') ||
      normalizedUserMsg.includes('phòng nào') ||
      normalizedUserMsg.includes('những phòng') ||
      normalizedUserMsg.includes('các phòng')
    ) {
      try {
        const rooms = await this.chatbotDataService.getHotelRooms(
          hotel._id.toString(),
        );
        if (rooms.length > 0) {
          const roomInfo = rooms
            .map(
              (r) =>
                `- ${r.name} (${r.room_type}): sức chứa ${r.capacity} người`,
            )
            .join('\n');

          return `Khách sạn ${hotel.name} có các loại phòng sau:\n${roomInfo}`;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi lấy loại phòng: ${error.message}`);
      }
    }

    // Thông tin tổng quan
    if (
      normalizedUserMsg.includes('thông tin') ||
      normalizedUserMsg.includes('giới thiệu')
    ) {
      try {
        // Lấy thông tin chi tiết của khách sạn
        const hotelDetails = await this.chatbotDataService.getHotelDetails(
          hotel._id.toString(),
        );

        // Lấy thông tin phòng để tính khoảng giá
        const rooms = await this.chatbotDataService.getHotelRooms(
          hotel._id.toString(),
        );

        let response = `🏨 **THÔNG TIN KHÁCH SẠN ${hotel.name.toUpperCase()}**\n\n`;

        // Thông tin cơ bản
        response += `📍 **Vị trí:** ${hotelDetails?.address || hotel.city}\n`;
        response += `⭐ **Hạng sao:** ${hotel.rating} sao\n`;
        response += `🏙️ **Thành phố:** ${hotel.city}\n\n`;

        // Thông tin giá phòng
        if (rooms.length > 0) {
          const prices = rooms
            .map((r) => r.price_per_night)
            .filter((p) => p && p > 0);
          if (prices.length > 0) {
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);

            if (minPrice === maxPrice) {
              response += `💰 **Giá phòng:** ${minPrice.toLocaleString()} VND/đêm\n\n`;
            } else {
              response += `💰 **Giá phòng:** từ ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()} VND/đêm\n\n`;
            }
          }
        }

        // Thông tin tiện ích (nếu có)
        if (hotelDetails?.amenities && hotelDetails.amenities.length > 0) {
          const formattedAmenities = this.formatAmenities(
            hotelDetails.amenities,
          );
          response += `🎯 **Tiện ích nổi bật:** ${formattedAmenities.slice(0, 5).join(', ')}`;
          if (formattedAmenities.length > 5) {
            response += ` và ${formattedAmenities.length - 5} tiện ích khác`;
          }
          response += '\n\n';
        }

        response += `Bạn muốn biết thêm thông tin gì cụ thể về khách sạn này? (giá phòng chi tiết, tiện ích, loại phòng...)`;

        return response;
      } catch (error) {
        this.logger.error(
          `Lỗi khi lấy thông tin chi tiết khách sạn: ${error.message}`,
        );
        // Fallback về thông tin cơ bản
        return `Khách sạn ${hotel.name} là khách sạn ${hotel.rating} sao tại ${hotel.city}. Bạn muốn biết thêm thông tin gì cụ thể về khách sạn này?`;
      }
    }

    return null;
  }
}
