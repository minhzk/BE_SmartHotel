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
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { RoomStatus } from '../room-availability/schemas/room-availability.schema';
import { InjectConnection } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import dayjs from 'dayjs';

@Injectable()
export class BookingsScheduleService {
  private readonly logger = new Logger(BookingsScheduleService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly notificationsService: NotificationsService,
    private readonly roomAvailabilityService: RoomAvailabilityService,
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

  /**
   * Task chạy mỗi giờ một lần để tự động hủy các booking chưa thanh toán quá 10 phút
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoExpireUnpaidBookings() {
    this.logger.log(
      'Đang kiểm tra và tự động hủy các booking chưa thanh toán...',
    );

    try {
      // Tìm tất cả booking chưa thanh toán và đã quá 10 phút
      const expiredTime = dayjs().subtract(10, 'minute').toDate();

      const expiredBookings = await this.bookingModel.find({
        status: BookingStatus.PENDING,
        payment_status: PaymentStatus.PENDING,
        createdAt: { $lte: expiredTime },
      });

      let expiredCount = 0;

      // Lấy thông tin khách sạn một lần để tối ưu hiệu suất
      const hotelIds = [
        ...new Set(expiredBookings.map((b) => b.hotel_id.toString())),
      ];
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

      for (const booking of expiredBookings) {
        try {
          // Cập nhật trạng thái booking
          await this.bookingModel.findByIdAndUpdate(booking._id, {
            status: BookingStatus.EXPIRED,
            payment_status: PaymentStatus.EXPIRED,
            cancellation_reason:
              'Auto-expired due to non-payment after 2 hours',
            cancelled_at: new Date(),
          });

          // Giải phóng room availability
          const checkInDate = dayjs.utc(booking.check_in_date).startOf('day');
          const checkOutDate = dayjs.utc(booking.check_out_date).startOf('day');

          await this.roomAvailabilityService.bulkUpdateStatus(
            booking.room_id.toString(),
            checkInDate.toDate(),
            checkOutDate.subtract(1, 'day').toDate(),
            RoomStatus.AVAILABLE,
          );

          // Gửi thông báo booking đã hết hạn
          try {
            const hotelName =
              hotelMap[booking.hotel_id.toString()] || 'Khách sạn';
            await this.notificationsService.createBookingExpiredNotification(
              booking.user_id.toString(),
              booking.booking_id,
              hotelName,
            );
          } catch (notificationError) {
            this.logger.error(
              `Lỗi khi gửi thông báo hết hạn cho booking ${booking.booking_id}: ${notificationError.message}`,
            );
          }

          expiredCount++;
          this.logger.log(`Đã tự động hủy booking: ${booking.booking_id}`);
        } catch (error) {
          this.logger.error(
            `Lỗi khi tự động hủy booking ${booking.booking_id}: ${error.message}`,
          );
        }
      }

      this.logger.log(`Đã tự động hủy ${expiredCount} booking chưa thanh toán`);
    } catch (error) {
      this.logger.error('Lỗi khi tự động hủy booking chưa thanh toán:', error);
    }
  }
}
