import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
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
import { BookingsService } from './bookings.service';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class BookingsScheduleService {
  private readonly logger = new Logger(BookingsScheduleService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    private readonly notificationsService: NotificationsService,
    private readonly roomAvailabilityService: RoomAvailabilityService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
    private readonly mailerService: MailerService,
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
    // Tạo ngày hiện tại với giờ 12:00 PM để so sánh
    const todayNoon = dayjs()
      .hour(12)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate();

    try {
      // Tìm các booking thỏa mãn điều kiện
      const result = await this.bookingModel.updateMany(
        {
          status: BookingStatus.CONFIRMED,
          payment_status: PaymentStatus.PAID,
          $or: [
            { check_out_date: { $lt: dayjs().startOf('day').toDate() } }, // Ngày check-out đã qua hoàn toàn
            {
              check_out_date: {
                $gte: dayjs().startOf('day').toDate(),
                $lt: dayjs().add(1, 'day').startOf('day').toDate(),
              },
              // Nếu là ngày check-out hôm nay và đã qua 12h trưa
              $expr: { $lte: [todayNoon, now] },
            },
          ],
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

  /**
   * Task chạy hàng ngày để gửi thông báo nhắc nhở thanh toán số tiền còn lại
   * Gửi nhắc nhở cho những booking còn 3 ngày trước check-in và chưa thanh toán đầy đủ
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async sendPaymentDueReminders() {
    this.logger.log(
      'Đang gửi thông báo nhắc nhở thanh toán số tiền còn lại...',
    );

    try {
      const threeDaysFromNow = dayjs().add(3, 'day').startOf('day');
      const fourDaysFromNow = dayjs().add(4, 'day').startOf('day');

      // Tìm các booking đã đặt cọc nhưng chưa thanh toán đầy đủ và sắp check-in trong 3 ngày
      const bookings = await this.bookingModel.find({
        status: BookingStatus.CONFIRMED,
        deposit_status: 'paid',
        payment_status: PaymentStatus.PARTIALLY_PAID,
        check_in_date: {
          $gte: threeDaysFromNow.toDate(),
          $lt: fourDaysFromNow.toDate(),
        },
      });

      this.logger.log(
        `Tìm thấy ${bookings.length} booking cần nhắc nhở thanh toán`,
      );

      // Lấy thông tin khách sạn và người dùng
      const hotelIds = [...new Set(bookings.map((b) => b.hotel_id.toString()))];
      const userIds = [...new Set(bookings.map((b) => b.user_id.toString()))];

      const [hotels, users] = await Promise.all([
        this.connection.db
          .collection('hotels')
          .find({
            _id: { $in: hotelIds.map((id) => new mongoose.Types.ObjectId(id)) },
          })
          .toArray(),
        this.connection.db
          .collection('users')
          .find({
            _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
          })
          .toArray(),
      ]);

      const hotelMap = hotels.reduce((map, hotel) => {
        map[hotel._id.toString()] = hotel.name;
        return map;
      }, {});

      const userMap = users.reduce((map, user) => {
        map[user._id.toString()] = user;
        return map;
      }, {});

      for (const booking of bookings) {
        try {
          const hotelName =
            hotelMap[booking.hotel_id.toString()] || 'Khách sạn';
          const user = userMap[booking.user_id.toString()];

          // Gửi thông báo trong app
          await this.notificationsService.createPaymentDueReminderNotification(
            booking.user_id.toString(),
            booking.booking_id,
            hotelName,
            booking.remaining_amount,
            booking.check_in_date,
          );

          // Gửi email nhắc nhở
          if (user?.email) {
            await this.mailerService.sendMail({
              to: user.email,
              subject: 'Nhắc nhở thanh toán số tiền còn lại - SmartHotel',
              template: 'payment-reminder',
              context: {
                name: user.name || user.email,
                bookingId: booking.booking_id,
                hotelName: hotelName,
                remainingAmount:
                  booking.remaining_amount.toLocaleString('vi-VN'),
                checkInDate: dayjs(booking.check_in_date).format('DD/MM/YYYY'),
                paymentUrl: `${process.env.FRONTEND_URL}/bookings/payment/${booking.booking_id}?type=remaining`,
              },
            });

            this.logger.log(
              `Đã gửi email nhắc nhở thanh toán cho user: ${user.email}`,
            );
          }

          this.logger.log(
            `Đã gửi thông báo nhắc nhở thanh toán cho booking: ${booking.booking_id}`,
          );
        } catch (error) {
          this.logger.error(
            `Lỗi khi gửi thông báo nhắc nhở thanh toán cho booking ${booking.booking_id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Lỗi khi gửi thông báo nhắc nhở thanh toán:', error);
    }
  }

  /**
   * Task chạy mỗi ngày lúc nửa đêm để kiểm tra và hủy các booking chỉ đặt cọc
   * mà chưa hoàn thành thanh toán trước 2 ngày check-in
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async autoCancelIncompletePaymentBookings() {
    this.logger.log(
      'Đang kiểm tra và hủy các booking chưa hoàn thành thanh toán trước deadline...',
    );

    try {
      // Tính ngày sau 2 ngày nữa (deadline thanh toán)
      const twoDaysFromNow = dayjs().add(3, 'day').startOf('day').toDate();

      // Tìm các booking chỉ đặt cọc nhưng chưa hoàn thành thanh toán
      // và sắp đến hạn check-in (trong vòng 2 ngày)
      const incompleteBookings = await this.bookingModel.find({
        status: BookingStatus.CONFIRMED,
        deposit_status: 'paid',
        payment_status: PaymentStatus.PARTIALLY_PAID,
        check_in_date: { $lte: twoDaysFromNow },
      });

      let canceledCount = 0;

      // Lấy thông tin khách sạn một lần để tối ưu hiệu suất
      const hotelIds = [
        ...new Set(incompleteBookings.map((b) => b.hotel_id.toString())),
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

      for (const booking of incompleteBookings) {
        try {
          // Cập nhật trạng thái booking thành CANCELED
          await this.bookingModel.findByIdAndUpdate(booking._id, {
            status: BookingStatus.CANCELED,
            cancellation_reason:
              'Auto-canceled due to incomplete payment before check-in deadline',
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

          // Logic hoàn tiền deposit sử dụng processRefund method từ BookingsService
          if (booking.deposit_status === 'paid' && booking.deposit_amount > 0) {
            try {
              await this.bookingsService['processRefund'](
                booking,
                booking.user_id.toString(),
              );
              this.logger.log(
                `Đã hoàn tiền ${booking.deposit_amount} VNĐ cho booking ${booking.booking_id}`,
              );
            } catch (refundError) {
              this.logger.error(
                `Lỗi khi hoàn tiền cho booking ${booking.booking_id}: ${refundError.message}`,
              );
            }
          }

          // Gửi thông báo booking bị hủy do chưa hoàn thành thanh toán
          try {
            const hotelName =
              hotelMap[booking.hotel_id.toString()] || 'Khách sạn';
            await this.notificationsService.createBookingCanceledNotification(
              booking.user_id.toString(),
              booking.booking_id,
              hotelName,
              'Booking đã bị hủy do chưa hoàn thành thanh toán trước deadline check-in',
            );
          } catch (notificationError) {
            this.logger.error(
              `Lỗi khi gửi thông báo hủy booking ${booking.booking_id}: ${notificationError.message}`,
            );
          }

          canceledCount++;
          this.logger.log(
            `Đã hủy booking do chưa hoàn thành thanh toán: ${booking.booking_id}`,
          );
        } catch (error) {
          this.logger.error(
            `Lỗi khi hủy booking ${booking.booking_id}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `Đã hủy ${canceledCount} booking do chưa hoàn thành thanh toán trước deadline`,
      );
    } catch (error) {
      this.logger.error(
        'Lỗi khi kiểm tra và hủy booking chưa hoàn thành thanh toán:',
        error,
      );
    }
  }
}
