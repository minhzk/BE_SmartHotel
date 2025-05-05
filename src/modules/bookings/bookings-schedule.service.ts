import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Booking,
  BookingStatus,
  PaymentStatus,
} from './schemas/booking.schema';

@Injectable()
export class BookingsScheduleService {
  private readonly logger = new Logger(BookingsScheduleService.name);

  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
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
}
