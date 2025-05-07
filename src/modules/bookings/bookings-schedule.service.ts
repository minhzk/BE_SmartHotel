import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Booking,
  BookingStatus,
  PaymentStatus,
} from './schemas/booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { InjectConnection } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import dayjs from 'dayjs';

@Injectable()
export class BookingsScheduleService {
  private readonly logger = new Logger(BookingsScheduleService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly notificationsService: NotificationsService,
    @InjectConnection() private readonly connection: mongoose.Connection,
  ) {}

  /**
   * Task chạy mỗi giờ một lần để kiểm tra và cập nhật các booking đã hoàn thành
   * Sẽ chuyển các booking sang trạng thái COMPLETED nếu:
   * - Booking có status = CONFIRMED
   * - Ngày check-out đã qua
   * - Đã thanh toán đầy đủ (payment_status = PAID)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkAndUpdateCompletedBookings() {
    this.logger.log(
      'Đang kiểm tra các booking cần được chuyển sang trạng thái hoàn thành...',
    );

    const now = new Date();

    try {
      // Tìm các booking thỏa mãn điều kiện
      const result = await this.bookingModel.updateMany(
        {
          status: BookingStatus.CONFIRMED,
          payment_status: PaymentStatus.PAID,
          check_out_date: { $lt: now }, // Ngày check-out đã qua
        },
        {
          $set: { status: BookingStatus.COMPLETED },
        },
      );

      if (result.modifiedCount > 0) {
        this.logger.log(
          `Đã cập nhật ${result.modifiedCount} booking sang trạng thái COMPLETED`,
        );
      } else {
        this.logger.debug('Không có booking nào cần cập nhật');
      }
    } catch (error) {
      this.logger.error('Lỗi khi cập nhật trạng thái booking:', error);
    }
  }

  /**
   * Task chạy hàng ngày để gửi thông báo nhắc nhở check-in
   * Gửi nhắc nhở cho những booking sắp check-in trong 1 ngày
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendCheckInReminders() {
    this.logger.log('Đang gửi thông báo nhắc nhở check-in...');

    try {
      const tomorrow = dayjs().add(1, 'day').startOf('day');
      const dayAfter = dayjs().add(2, 'day').startOf('day');

      // Tìm các booking đã xác nhận và sắp check-in trong ngày mai
      const bookings = await this.bookingModel.find({
        status: BookingStatus.CONFIRMED,
        check_in_date: {
          $gte: tomorrow.toDate(),
          $lt: dayAfter.toDate(),
        },
      });

      this.logger.log(
        `Tìm thấy ${bookings.length} booking cần nhắc nhở check-in`,
      );

      // Gửi thông báo cho từng booking
      const hotelIds = [...new Set(bookings.map((b) => b.hotel_id.toString()))];
      const hotels = await this.connection.db
        .collection('hotels')
        .find({
          _id: { $in: hotelIds.map((id) => new mongoose.Types.ObjectId(id)) },
        })
        .toArray();

      const hotelMap = hotels.reduce((map, hotel) => {
        map[hotel._id.toString()] = hotel.name;
        return map;
      }, {});

      for (const booking of bookings) {
        try {
          const hotelName =
            hotelMap[booking.hotel_id.toString()] || 'Khách sạn';

          await this.notificationsService.createCheckInReminderNotification(
            booking.user_id.toString(),
            booking.booking_id,
            hotelName,
            booking.check_in_date,
          );

          this.logger.log(
            `Đã gửi thông báo nhắc nhở check-in cho booking: ${booking.booking_id}`,
          );
        } catch (error) {
          this.logger.error(
            `Lỗi khi gửi thông báo nhắc nhở cho booking ${booking.booking_id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Lỗi khi gửi thông báo nhắc nhở check-in:', error);
    }
  }
}
