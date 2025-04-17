import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Public()
  @Post('sessions')
  @ResponseMessage('Create chat session successfully')
  createSession(@Request() req, @Body() createSessionDto: CreateSessionDto) {
    // If user is logged in, get their ID
    const userId = req.user ? req.user._id : createSessionDto.user_id;
    return this.chatbotService.createSession(userId, createSessionDto);
  }

  @Public()
  @Post('messages')
  @ResponseMessage('Send message successfully')
  sendMessage(@Body() sendMessageDto: SendMessageDto) {
    return this.chatbotService.sendMessage(sendMessageDto);
  }

  @Public()
  @Get('sessions/:sessionId/messages')
  @ResponseMessage('Fetch chat messages successfully')
  getChatHistory(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit: string,
  ) {
    return this.chatbotService.getChatHistory(sessionId, limit ? +limit : 50);
  }

  @Get('sessions')
  @ResponseMessage('Fetch user chat sessions successfully')
  getUserSessions(@Request() req) {
    return this.chatbotService.getUserSessions(req.user._id);
  }

  @Post('sessions/:sessionId/close')
  @ResponseMessage('Close chat session successfully')
  closeSession(@Param('sessionId') sessionId: string) {
    return this.chatbotService.closeSession(sessionId);
  }

  @Public()
  @Post('feedback')
  @ResponseMessage('Send chatbot feedback successfully')
  sendFeedback(
    @Body()
    feedback: {
      messageId: string;
      sessionId: string;
      feedbackType: string;
      feedbackText?: string;
      userId?: string;
    },
  ) {
    return this.chatbotService.saveFeedback(feedback);
  }
}
