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
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<Notification>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async create(createNotificationDto: CreateNotificationDto) {
    // Tạo thông báo trong database
    const notification = await this.notificationModel.create(
      createNotificationDto,
    );

    // Gửi thông báo qua socket
    if (notification) {
      this.notificationsGateway.sendNotificationToUser(
        createNotificationDto.user_id,
        notification,
      );
    }

    return notification;
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

  // Thêm các phương thức tạo thông báo khác
  async createBookingConfirmedNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
  ) {
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: 'Đặt phòng đã được xác nhận',
      message: `Đặt phòng của bạn tại ${hotelName} đã được xác nhận. Mã đặt phòng: ${bookingId}`,
      data: { booking_id: bookingId },
    });

    return notification;
  }

  async createBookingCanceledNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
    customMessage?: string,
  ) {
    const defaultMessage = `Đặt phòng ${bookingId} tại ${hotelName} đã bị hủy`;
    const message = customMessage || defaultMessage;

    return this.create({
      user_id: userId,
      type: NotificationType.BOOKING_CANCELED,
      title: 'Đặt phòng đã bị hủy',
      message: message,
      data: {
        booking_id: bookingId,
        hotel_name: hotelName,
        action_url: `/bookings/${bookingId}`,
      },
    });
  }

  async createPaymentReceivedNotification(
    userId: string,
    bookingId: string,
    amount: number,
    paymentType: 'deposit' | 'remaining' | 'full' | 'wallet_deposit' = 'full',
  ) {
    // Cập nhật tiêu đề và nội dung thông báo tùy theo loại thanh toán
    let title = 'Thanh toán thành công';
    let message = `Bạn đã thanh toán thành công ${amount.toLocaleString('vi-VN')} VNĐ cho đơn đặt phòng ${bookingId}`;

    if (paymentType === 'deposit') {
      title = 'Thanh toán đặt cọc thành công';
      message = `Bạn đã thanh toán đặt cọc thành công ${amount.toLocaleString('vi-VN')} VNĐ cho đơn đặt phòng ${bookingId}`;
    } else if (paymentType === 'remaining') {
      title = 'Thanh toán số tiền còn lại thành công';
      message = `Bạn đã thanh toán số tiền còn lại thành công ${amount.toLocaleString('vi-VN')} VNĐ cho đơn đặt phòng ${bookingId}`;
    } else if (paymentType === 'wallet_deposit') {
      title = 'Nạp tiền vào ví thành công';
      message = `Bạn đã nạp thành công ${amount.toLocaleString('vi-VN')} VNĐ vào ví`;
    }

    const notification = await this.create({
      user_id: userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title,
      message,
      data: {
        booking_id: bookingId,
        amount,
        payment_type: paymentType,
      },
    });

    return notification;
  }

  async createCheckInReminderNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
    checkInDate: Date,
  ) {
    const formattedDate = new Date(checkInDate).toLocaleDateString('vi-VN');
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.CHECK_IN_REMINDER,
      title: 'Nhắc nhở check-in',
      message: `Bạn sẽ check-in vào ngày ${formattedDate} tại ${hotelName}. Mã đặt phòng: ${bookingId}`,
      data: { booking_id: bookingId, check_in_date: checkInDate },
    });

    return notification;
  }

  async createRefundNotification(
    userId: string,
    bookingId: string,
    amount: number,
    transactionId: string,
  ) {
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.PAYMENT_REFUNDED, // Sử dụng kiểu thông báo mới
      title: 'Hoàn tiền thành công',
      message: `Bạn đã được hoàn ${amount.toLocaleString('vi-VN')} VNĐ cho đơn đặt phòng ${bookingId}`,
      data: {
        booking_id: bookingId,
        amount: amount,
        transaction_id: transactionId,
      },
    });

    return notification;
  }

  async createBookingExpiredNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
  ) {
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.BOOKING_EXPIRED,
      title: 'Đặt phòng đã hết hạn',
      message: `Đặt phòng của bạn tại ${hotelName} đã hết hạn do chưa thanh toán trong thời gian quy định. Mã đặt phòng: ${bookingId}`,
      data: { booking_id: bookingId },
    });

    return notification;
  }

  async createPaymentDueReminderNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
    remainingAmount: number,
    checkInDate: Date,
  ) {
    const formattedDate = new Date(checkInDate).toLocaleDateString('vi-VN');
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.PAYMENT_DUE,
      title: 'Nhắc nhở thanh toán số tiền còn lại',
      message: `Bạn cần thanh toán số tiền còn lại ${remainingAmount.toLocaleString('vi-VN')} VNĐ cho đơn đặt phòng ${bookingId} tại ${hotelName}. Ngày check-in: ${formattedDate}`,
      data: {
        booking_id: bookingId,
        remaining_amount: remainingAmount,
        check_in_date: checkInDate,
        action_url: `/bookings/payment/${bookingId}?type=remaining`,
      },
    });

    return notification;
  }

  // Thêm phương thức gửi thông báo nhắc đánh giá
  async createReviewReminderNotification(
    userId: string,
    bookingId: string,
    hotelName: string,
  ) {
    const notification = await this.create({
      user_id: userId,
      type: NotificationType.REVIEW_REMINDER,
      title: 'Hãy đánh giá trải nghiệm của bạn',
      message: `Bạn vừa hoàn thành kỳ nghỉ tại ${hotelName}. Hãy để lại đánh giá để giúp khách sạn cải thiện dịch vụ!`,
      data: {
        booking_id: bookingId,
        hotel_name: hotelName,
        action_url: `/bookings/${bookingId}/review`,
      },
    });

    return notification;
  }
}
