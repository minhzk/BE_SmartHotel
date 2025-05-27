import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Payment, PaymentStatus, PaymentType } from './schemas/payment.schema';
import { VnpayService } from './vnpay/vnpay.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { BookingsService } from '../bookings/bookings.service';
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { User } from '../users/schemas/user.schema';
import aqp from 'api-query-params';
import { v4 as uuidv4 } from 'uuid';
import { NotificationsService } from '../notifications/notifications.service';
import { RoomStatus } from '../room-availability/schemas/room-availability.schema';
import dayjs from 'dayjs';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name)
    private paymentModel: Model<Payment>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private readonly vnpayService: VnpayService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
    private readonly roomAvailabilityService: RoomAvailabilityService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createPayment(userId: string, createPaymentDto: CreatePaymentDto) {
    // Find the booking
    const booking = await this.bookingsService.findOne(
      createPaymentDto.booking_id,
      userId,
    );

    // Validate payment amount based on payment type
    let paymentAmount = 0;

    if (createPaymentDto.payment_type === PaymentType.DEPOSIT) {
      // Check if deposit has already been paid
      if (booking.deposit_status === 'paid') {
        throw new BadRequestException(
          'Deposit has already been paid for this booking',
        );
      }
      paymentAmount = booking.deposit_amount;
    } else if (createPaymentDto.payment_type === PaymentType.REMAINING) {
      // Check if deposit has been paid
      if (booking.deposit_status !== 'paid') {
        throw new BadRequestException(
          'Deposit must be paid before paying the remaining amount',
        );
      }
      // Check if full payment has already been made
      if (booking.payment_status === 'paid') {
        throw new BadRequestException(
          'Full payment has already been made for this booking',
        );
      }
      paymentAmount = booking.remaining_amount;
    } else if (createPaymentDto.payment_type === PaymentType.FULL_PAYMENT) {
      // Only allow full payment if no payments have been made yet
      if (booking.deposit_status === 'paid') {
        throw new BadRequestException(
          'Partial payment has already been made for this booking',
        );
      }
      paymentAmount = booking.total_amount;
    }

    // Handle wallet deposit (different from booking payments)
    if (createPaymentDto.payment_type === PaymentType.WALLET_DEPOSIT) {
      paymentAmount = createPaymentDto.amount;
    }

    // Override amount if explicitly provided
    if (createPaymentDto.amount && createPaymentDto.amount > 0) {
      paymentAmount = createPaymentDto.amount;
    }

    // Validate amount
    if (paymentAmount <= 0) {
      throw new BadRequestException('Invalid payment amount');
    }

    // Handle different payment methods
    if (createPaymentDto.payment_method === 'wallet') {
      // For wallet payment, process immediately
      if (createPaymentDto.payment_type === PaymentType.WALLET_DEPOSIT) {
        throw new BadRequestException('Cannot use wallet to deposit to wallet');
      }

      return await this.processWalletPayment(
        userId,
        booking,
        paymentAmount,
        createPaymentDto.payment_type,
      );
    } else if (createPaymentDto.payment_method === 'vnpay') {
      // For VNPay, create a payment record and return the payment URL
      return await this.createVnpayPaymentUrl(
        userId,
        booking._id.toString(),
        booking.booking_id,
        paymentAmount,
        createPaymentDto,
      );
    } else {
      throw new BadRequestException('Unsupported payment method');
    }
  }

  async findAll(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
    filters?: {
      paymentDate?: string;
      status?: string;
      paymentMethod?: string;
      paymentType?: string;
    },
  ) {
    const { filter, sort, population } = aqp(query);

    // Xóa các tham số current và pageSize từ filter nếu có
    delete filter.current;
    delete filter.pageSize;

    // Cũng xóa các tham số lọc đặc biệt khỏi filter vì sẽ xử lý riêng
    delete filter.paymentDate;
    delete filter.paymentType;
    delete filter.paymentMethod;

    // Xây dựng bộ lọc từ các tham số
    const customFilter: any = { ...filter };

    // Thêm filter theo userId nếu không phải admin
    const user = await this.userModel.findById(userId);
    if (user && user.role !== 'admin') {
      customFilter.user_id = new mongoose.Types.ObjectId(userId);
    }

    // Xử lý lọc theo payment_date - SỬA TỪ paymentDate THÀNH payment_date
    if (filters?.paymentDate) {
      // Nếu giá trị chứa dấu phẩy hoặc dấu gạch ngang, coi như là khoảng thời gian
      if (
        filters.paymentDate.includes(',') ||
        filters.paymentDate.includes('-')
      ) {
        let [startDate, endDate] = filters.paymentDate.includes(',')
          ? filters.paymentDate.split(',')
          : filters.paymentDate.split('-');

        // Xử lý startDate và endDate
        startDate = startDate.trim();
        endDate = endDate ? endDate.trim() : startDate;

        customFilter.payment_date = {
          // SỬA TỪ paymentDate THÀNH payment_date
          $gte: new Date(startDate),
          $lte: new Date(endDate + 'T23:59:59.999Z'),
        };
      }
    }

    // Thêm điều kiện lọc theo trạng thái, method và type
    if (filters?.status) {
      customFilter.status = filters.status;
    }
    if (filters?.paymentMethod) {
      customFilter.payment_method = filters.paymentMethod;
    }
    if (filters?.paymentType) {
      customFilter.payment_type = filters.paymentType;
    }

    // Đặt giá trị mặc định cho phân trang
    const defaultPageSize = 10;
    const defaultCurrent = 1;

    const skip =
      (current > 0 ? current - 1 : defaultCurrent - 1) *
      (pageSize > 0 ? pageSize : defaultPageSize);

    const limit = pageSize > 0 ? pageSize : defaultPageSize;

    // Thực hiện truy vấn
    const [results, totalItems] = await Promise.all([
      this.paymentModel
        .find(customFilter)
        .skip(skip)
        .limit(limit)
        .sort(sort as any)
        .populate(population)
        .exec(),
      this.paymentModel.countDocuments(customFilter),
    ]);

    // Tính toán thông tin phân trang
    const totalPages = Math.ceil(totalItems / limit);

    return {
      meta: {
        current: current || defaultCurrent,
        pageSize: limit,
        pages: totalPages,
        total: totalItems,
      },
      results,
    };
  }

  async findOne(id: string, userId: string) {
    let payment;

    // Find by transaction_id or MongoDB _id
    if (mongoose.isValidObjectId(id)) {
      payment = await this.paymentModel.findById(id);
    } else {
      payment = await this.paymentModel.findOne({ transaction_id: id });
    }

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Check if user has permissions to view this payment
    const isAdmin = await this.checkIfUserIsAdmin(userId);
    if (!isAdmin && payment.user_id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to view this payment',
      );
    }

    return payment;
  }

  async getPaymentStatus(transactionId: string, userId: string) {
    // Get payment by transaction ID
    const payment = await this.findOne(transactionId, userId);

    // For VNPay payments, query latest status from VNPay
    if (
      payment.payment_method === 'vnpay' &&
      payment.status === PaymentStatus.PENDING
    ) {
      return await this.vnpayService.queryTransactionStatus(transactionId);
    }

    // For other payment methods or completed payments, return current status
    return {
      transaction_id: payment.transaction_id,
      booking_id: payment.booking_id,
      status: payment.status,
      amount: payment.amount,
      payment_date: payment.payment_date,
    };
  }

  private async processWalletPayment(
    userId: string,
    booking: any,
    amount: number,
    paymentType: PaymentType,
  ) {
    // Implementation similar to bookingsService.processWalletPayment
    // Validate user has enough balance, update user balance, update booking status

    // Create a payment record for tracking
    const transactionId = `TP-${uuidv4().substring(0, 8)}`;

    const payment = await this.paymentModel.create({
      transaction_id: transactionId,
      booking_id: booking.booking_id,
      user_id: userId,
      amount,
      payment_type: paymentType,
      payment_method: 'wallet',
      status: PaymentStatus.COMPLETED, // Wallet payments are completed immediately
      payment_date: new Date(),
    });

    // Cập nhật room availability status sau khi thanh toán thành công
    await this.updateRoomStatusAfterPayment(booking);

    // Xác định loại thanh toán cho thông báo
    let notificationType: 'deposit' | 'remaining' | 'full' = 'full';
    if (paymentType === PaymentType.DEPOSIT) notificationType = 'deposit';
    else if (paymentType === PaymentType.REMAINING)
      notificationType = 'remaining';

    // Gửi thông báo thanh toán thành công
    try {
      await this.notificationsService.createPaymentReceivedNotification(
        userId,
        booking.booking_id,
        amount,
        notificationType, // Thêm tham số loại thanh toán
      );
    } catch (error) {
      console.error(`Lỗi khi gửi thông báo thanh toán: ${error.message}`);
      // Không làm ảnh hưởng đến luồng chính nếu gửi thông báo thất bại
    }

    return {
      payment,
      message: 'Payment processed successfully',
    };
  }

  private async createVnpayPaymentUrl(
    userId: string,
    bookingObjectId: string,
    bookingId: string,
    amount: number,
    createPaymentDto: CreatePaymentDto,
  ) {
    // Call VNPay service to create payment URL
    const { payment, paymentUrl } = await this.vnpayService.createPaymentUrl({
      user_id: userId,
      booking_id: bookingId,
      amount,
      payment_type: createPaymentDto.payment_type,
      redirect_url: createPaymentDto.redirect_url,
      client_ip: createPaymentDto.client_ip,
    });

    return {
      transaction_id: payment.transaction_id,
      payment_url: paymentUrl,
      amount: payment.amount,
      payment_type: payment.payment_type,
      message: 'Payment URL created successfully',
    };
  }

  async processVnpayReturn(vnpParams: any) {
    const result = await this.vnpayService.processReturnUrl(vnpParams);
    return result;
  }

  async processVnpayReturnWithRedirect(vnpParams: any, res: any): Promise<any> {
    try {
      // Xử lý thanh toán
      const result = await this.vnpayService.processReturnUrl(vnpParams);

      // Cập nhật room status và gửi thông báo nếu thành công
      if (
        result.success &&
        result.paymentInfo &&
        result.paymentInfo.status === PaymentStatus.COMPLETED
      ) {
        try {
          console.log("result.paymentInfo222:", result.paymentInfo);
          // Cập nhật room status cho VNPay payments
          const booking = await this.bookingsService.findOne(
            result.paymentInfo.booking_id,
          );
          console.log("booking:", booking);
          await this.updateRoomStatusAfterPayment(
            booking
          );

          console.log("updateRoomStatusAfterPayment done");

          await this.notificationsService.createPaymentReceivedNotification(
            result.paymentInfo.user_id,
            result.paymentInfo.booking_id,
            result.paymentInfo.amount,
          );
        } catch (error) {
          console.error(`Lỗi khi xử lý sau thanh toán VNPay: ${error.message}`);
        }
      }

      // Tạo URL để redirect đến frontend
      const frontendUrl = new URL(this.vnpayService.getFrontendResultUrl());

      // Thêm các tham số kết quả thanh toán vào URL
      frontendUrl.searchParams.append('success', result.success.toString());
      frontendUrl.searchParams.append(
        'transaction_id',
        result.paymentInfo.transaction_id,
      );
      frontendUrl.searchParams.append(
        'booking_id',
        result.paymentInfo.booking_id,
      );
      frontendUrl.searchParams.append('status', result.paymentInfo.status);

      // Redirect người dùng đến frontend
      res.redirect(frontendUrl.toString());

      // Không trả về dữ liệu vì đã redirect
      return null;
    } catch (error) {
      // Nếu có lỗi, vẫn redirect về frontend với thông báo lỗi
      const frontendUrl = new URL(this.vnpayService.getFrontendResultUrl());
      frontendUrl.searchParams.append('success', 'false');
      frontendUrl.searchParams.append(
        'error',
        error.message || 'Payment processing failed',
      );

      res.redirect(frontendUrl.toString());
      return null;
    }
  }

  async processVnpayIpn(vnpParams: any) {
    const result = await this.vnpayService.processIpnUrl(vnpParams);
    return result;
  }

  async depositToWallet(
    userId: string,
    amount: number,
    clientIp: string,
    redirectUrl?: string,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Deposit amount must be greater than 0');
    }

    // Create VNPay payment URL for wallet deposit
    const transactionId = `WD-${uuidv4().substring(0, 8)}`;

    const payment = await this.paymentModel.create({
      transaction_id: transactionId,
      booking_id: 'wallet-deposit', // Special identifier for wallet deposits
      user_id: userId,
      amount,
      payment_type: PaymentType.WALLET_DEPOSIT,
      payment_method: 'vnpay',
      status: PaymentStatus.PENDING,
      redirect_url: redirectUrl,
    });

    const { paymentUrl } = await this.vnpayService.createPaymentUrl({
      user_id: userId,
      booking_id: 'wallet-deposit',
      amount,
      payment_type: PaymentType.WALLET_DEPOSIT,
      redirect_url: redirectUrl,
      client_ip: clientIp,
    });

    return {
      transaction_id: payment.transaction_id,
      payment_url: paymentUrl,
      amount,
      message: 'Wallet deposit URL created successfully',
    };
  }

  private async checkIfUserIsAdmin(userId: string): Promise<boolean> {
    // Implementation to check if user is admin
    // This would call UserService or check directly
    return false; // Default for simplicity
  }

  async processRefund(
    paymentId: string,
    userId: string,
    amount?: number,
  ): Promise<any> {
    // Tìm giao dịch thanh toán gốc
    const originalPayment = await this.findOne(paymentId, userId);

    if (originalPayment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Only completed payments can be refunded');
    }

    // Nếu không chỉ định số tiền hoàn, hoàn toàn bộ
    const refundAmount = amount || originalPayment.amount;

    if (refundAmount <= 0 || refundAmount > originalPayment.amount) {
      throw new BadRequestException('Invalid refund amount');
    }

    let result;
    // Xử lý hoàn tiền dựa trên phương thức thanh toán
    if (originalPayment.payment_method === 'vnpay') {
      // Gọi đến VNPay service để xử lý hoàn tiền
      result = await this.vnpayService.createRefundTransaction(
        originalPayment.transaction_id,
        refundAmount,
        `Hoàn tiền cho đặt phòng ${originalPayment.booking_id}`,
      );
    } else if (originalPayment.payment_method === 'wallet') {
      // Tạo ID giao dịch hoàn tiền
      const refundTransactionId = `RF-${uuidv4().substring(0, 8)}`;

      // Tạo bản ghi giao dịch hoàn tiền
      const refundPayment = await this.paymentModel.create({
        transaction_id: refundTransactionId,
        booking_id: originalPayment.booking_id,
        user_id: originalPayment.user_id,
        amount: refundAmount,
        payment_type: PaymentType.REFUND,
        payment_method: 'wallet',
        status: PaymentStatus.COMPLETED,
        payment_date: new Date(),
      });

      result = {
        transaction_id: refundPayment.transaction_id,
        original_transaction_id: originalPayment.transaction_id,
        amount: refundAmount,
        status: PaymentStatus.REFUNDED,
        message: 'Refunded to wallet successfully',
      };
    } else {
      throw new BadRequestException(
        `Refund not supported for payment method: ${originalPayment.payment_method}`,
      );
    }

    // Gửi thông báo hoàn tiền thành công
    try {
      await this.notificationsService.createRefundNotification(
        originalPayment.user_id.toString(),
        originalPayment.booking_id,
        refundAmount,
        result.transaction_id,
      );
    } catch (error) {
      console.error(`Lỗi khi gửi thông báo hoàn tiền: ${error.message}`);
    }

    return result;
  }

  getFrontendResultUrl(): string {
    // Return the frontend URL where users should be redirected after payment
    return (
      process.env.FRONTEND_PAYMENT_RESULT_URL ||
      'http://localhost:3000/payment-result'
    );
  }

  /**
   * Helper method để cập nhật room status sau khi thanh toán thành công
   */
  private async updateRoomStatusAfterPayment(
    booking: any
  ) {
    try {
      const checkInDate = dayjs
        .utc(booking.check_in_date)
        .startOf('day')
        .toDate();
      const checkOutDate = dayjs
        .utc(booking.check_out_date)
        .startOf('day')
        .subtract(1, 'day')
        .toDate();
      
      console.log(
        `Cập nhật room status cho booking: ${booking.room_id.toString()}, checkIn: ${checkInDate}, checkOut: ${checkOutDate}`,)

      await this.roomAvailabilityService.updateRoomStatusAfterPayment(
        booking.room_id.toString(),
        checkInDate,
        checkOutDate,
        RoomStatus.BOOKED,
      );

      console.log(
        `Đã cập nhật room status từ RESERVED sang BOOKED cho booking: ${booking.booking_id}`,
      );
    } catch (error) {
      console.error('Lỗi khi cập nhật room status sau thanh toán:', error);
    }
  }
}
