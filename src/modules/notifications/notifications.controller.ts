import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  Request,
  Patch,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ResponseMessage } from '@/decorator/customize';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ResponseMessage('Fetch notifications successfully')
  findAll(
    @Request() req,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.notificationsService.findAll(
      req.user._id,
      query,
      +current,
      +pageSize,
    );
  }

  @Get('unread-count')
  @ResponseMessage('Fetch unread notifications count successfully')
  getUnreadCount(@Request() req) {
    return this.notificationsService.getUnreadCount(req.user._id);
  }

  @Patch(':id/mark-read')
  @ResponseMessage('Mark notification as read successfully')
  markAsRead(@Request() req, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user._id, id);
  }

  @Patch('mark-all-read')
  @ResponseMessage('Mark all notifications as read successfully')
  markAllAsRead(@Request() req) {
    return this.notificationsService.markAllAsRead(req.user._id);
  }

  @Delete(':id')
  @ResponseMessage('Delete notification successfully')
  remove(@Request() req, @Param('id') id: string) {
    return this.notificationsService.remove(req.user._id, id);
  }
}
