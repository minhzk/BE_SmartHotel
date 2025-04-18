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
import aqp from 'api-query-params';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name)
    private paymentModel: Model<Payment>,
    private readonly vnpayService: VnpayService,
    @Inject(forwardRef(() => BookingsService))
    private readonly bookingsService: BookingsService,
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
  ) {
    const { filter, sort, projection, population } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Non-admin users can only see their own payments
    const isAdmin = await this.checkIfUserIsAdmin(userId);
    if (!isAdmin) {
      filter.user_id = userId;
    }

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.paymentModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.paymentModel
      .find(filter)
      .limit(pageSize)
      .skip(skip)
      .sort(sort as any)
      .populate(population)
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

    // Note: This logic would normally update the booking status
    // and user wallet in a transaction, similar to BookingsService

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
    return await this.vnpayService.processReturnUrl(vnpParams);
  }

  async processVnpayReturnWithRedirect(vnpParams: any, res: any): Promise<any> {
    try {
      // Xử lý thanh toán
      const result = await this.vnpayService.processReturnUrl(vnpParams);

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
    return await this.vnpayService.processIpnUrl(vnpParams);
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

    // Xử lý hoàn tiền dựa trên phương thức thanh toán
    if (originalPayment.payment_method === 'vnpay') {
      // Gọi đến VNPay service để xử lý hoàn tiền
      return await this.vnpayService.createRefundTransaction(
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

      return {
        transaction_id: refundPayment.transaction_id,
        original_transaction_id: originalPayment.transaction_id,
        amount: refundAmount,
        status: PaymentStatus.REFUNDED,
        message: 'Refunded to wallet successfully',
      };
    }

    throw new BadRequestException(
      `Refund not supported for payment method: ${originalPayment.payment_method}`,
    );
  }
  
  getFrontendResultUrl(): string {
    // Return the frontend URL where users should be redirected after payment
    return process.env.FRONTEND_PAYMENT_RESULT_URL || 'http://localhost:3000/payment-result';
  }
}
