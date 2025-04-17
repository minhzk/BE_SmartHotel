import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification } from './schemas/notification.schema';
import { NotificationType } from './schemas/notification.schema';
import { CreateNotificationDto } from './dto/create-notification.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<Notification>,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    return await this.notificationModel.create(createNotificationDto);
  }

  async findAll(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    const { filter, sort, projection } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Ensure user can only see their own notifications
    filter.user_id = userId;

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.notificationModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.notificationModel
      .find(filter)
      .limit(pageSize)
      .skip(skip)
      .sort(sort || ({ createdAt: -1 } as any))
      .select(projection as any);

    return {
      meta: {
        current,
        pageSize,
        pages: totalPages,
        total: totalItems,
      },
      results,
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationModel.countDocuments({
      user_id: userId,
      read: false,
    });

    return { count };
  }

  async markAsRead(userId: string, id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid notification ID');
    }

    const notification = await this.notificationModel.findById(id);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.user_id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to access this notification',
      );
    }

    // Mark as read
    return await this.notificationModel.findByIdAndUpdate(
      id,
      { read: true, read_at: new Date() },
      { new: true },
    );
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      { user_id: userId, read: false },
      { read: true, read_at: new Date() },
    );

    return {
      success: true,
      count: result.modifiedCount,
    };
  }

  async remove(userId: string, id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid notification ID');
    }

    const notification = await this.notificationModel.findById(id);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.user_id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to access this notification',
      );
    }

    await this.notificationModel.findByIdAndDelete(id);

    return { deleted: true };
  }

  // Thêm phương thức này để tạo thông báo đặt phòng
  async createBookingNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
  ) {
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.BOOKING_CREATED,
      title: 'Đặt phòng thành công',
      message: `Bạn đã đặt phòng thành công tại ${hotelName}. Mã đặt phòng: ${bookingId}`,
      data: { booking_id: bookingId },
    });

    return notification;
  }
}
