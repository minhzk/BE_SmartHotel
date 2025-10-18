import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Booking,
  BookingStatus,
  CancellationPolicy,
  DepositStatus,
  PaymentStatus,
} from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { FilterBookingDto } from './dto/filter-booking.dto';
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { RoomStatus } from '../room-availability/schemas/room-availability.schema';
import { User } from '../users/schemas/user.schema';
import { Room } from '../rooms/schemas/room.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/schemas/payment.schema';
import mongoose from 'mongoose';
import aqp from 'api-query-params';
import { NotificationsService } from '../notifications/notifications.service';

dayjs.extend(utc);

@Injectable()
export class BookingsService {
  constructor(
    @InjectModel(Booking.name)
    private bookingModel: Model<Booking>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    @InjectModel(Room.name)
    private roomModel: Model<Room>,
    @InjectModel(Hotel.name)
    private hotelModel: Model<Hotel>,
    @InjectModel(Payment.name)
    private paymentModel: Model<Payment>,
    private readonly roomAvailabilityService: RoomAvailabilityService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(userId: string, createBookingDto: CreateBookingDto) {
    // Validate check-in and check-out dates
    const checkInDate = dayjs
      .utc(createBookingDto.check_in_date)
      .startOf('day');
    const checkOutDate = dayjs
      .utc(createBookingDto.check_out_date)
      .startOf('day');
    const today = dayjs.utc().startOf('day');

    if (checkInDate.isBefore(today)) {
      throw new BadRequestException('Check-in date cannot be in the past');
    }

    if (
      checkOutDate.isBefore(checkInDate) ||
      checkOutDate.isSame(checkInDate)
    ) {
      throw new BadRequestException(
        'Check-out date must be after check-in date',
      );
    }

    // Check if room exists
    const room = await this.roomModel.findById(createBookingDto.room_id);
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Check if hotel exists
    const hotel = await this.hotelModel.findById(createBookingDto.hotel_id);
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    // Check if hotel_id matches the room's hotel_id
    if (room.hotel_id.toString() !== createBookingDto.hotel_id) {
      throw new BadRequestException(
        'Room does not belong to the specified hotel',
      );
    }

    // Check room availability for the specified dates
    const isRoomAvailable = await this.checkRoomAvailability(
      createBookingDto.room_id,
      checkInDate.toDate(),
      checkInDate.toDate(),
    );

    if (!isRoomAvailable) {
      throw new BadRequestException(
        'Room is not available for the specified dates',
      );
    }

    // Calculate number of nights - sửa cách tính số đêm ở đây
    // Áp dụng quy tắc mới:phù hợp với thực tế:
    // - Check-in: vào 14h trưa của ngày check-in (thông thường là sau 14:00)
    // - Check-out: vào 12h trưa của ngày check-out (thông thường là trước 12:00)
    // - Số đêm = số ngày check-out - số ngày check-in
    // Ví dụ: Check-in 25/05, Check-out 27/05 => Số đêm = 27-25  = 2 đêm
    const nights = checkOutDate.diff(checkInDate, 'day');

    // Calculate total amount if not provided
    let totalAmount = createBookingDto.total_amount;
    if (!totalAmount) {
      totalAmount = room.price_per_night * nights;
    }

    // Calculate deposit amount (25% of total)
    const depositAmount = Math.round(totalAmount * 0.25);
    const remainingAmount = totalAmount - depositAmount;

    // Set payment due date (2 days before check-in)
    const paymentDueDate = checkInDate.subtract(2, 'day').toDate();

    // Generate unique booking ID
    const bookingId = `BK-${uuidv4().substring(0, 8)}`;

    // Xử lý 2 TH cho thông tin người dùng:
    // 1.Sử dụng thông tin từ DTO (được gửi từ FE)
    // Trường hợp người dùng muốn đặt phòng cho người khác
    const guestName = createBookingDto.guest_name;
    const guestEmail = createBookingDto.guest_email;
    const guestPhone = createBookingDto.guest_phone;

    // 2.Tự động lấy từ thông tin người dùng đã đăng nhập
    // Nếu không có thông tin trong DTO
    const user = await this.userModel.findById(userId);
    const bookingGuestName = guestName || user.name;
    const bookingGuestEmail = guestEmail || user.email;
    const bookingGuestPhone = guestPhone || user.phone;

    // Create booking - thêm thông tin chi tiết về check-in/check-out time
    const booking = await this.bookingModel.create({
      booking_id: bookingId,
      user_id: userId,
      hotel_id: createBookingDto.hotel_id,
      room_id: createBookingDto.room_id,
      check_in_date: checkInDate.hour(14).minute(0).second(0).toDate(), // Check-in at 14:00 (2:00 PM)
      check_out_date: checkOutDate.hour(12).minute(0).second(0).toDate(), // Check-out at 12:00 (12:00 PM)
      total_amount: totalAmount,
      deposit_amount: depositAmount,
      deposit_status: DepositStatus.UNPAID,
      remaining_amount: remainingAmount,
      status: BookingStatus.PENDING,
      cancellation_policy:
        createBookingDto.cancellation_policy || CancellationPolicy.CANCELABLE,
      payment_due_date: paymentDueDate,
      payment_status: PaymentStatus.PENDING,
      payment_method: createBookingDto.payment_method,
      guest_name: bookingGuestName,
      guest_email: bookingGuestEmail,
      guest_phone: bookingGuestPhone,
      special_requests: createBookingDto.special_requests,
      number_of_guests: createBookingDto.number_of_guests || 1,
    });

    // Mark the room as RESERVED (not BOOKED) for the date range until payment is confirmed
    await this.roomAvailabilityService.bulkUpdateStatus(
      createBookingDto.room_id,
      checkInDate.toDate(),
      checkOutDate.subtract(1, 'day').toDate(), // Not including checkout day
      RoomStatus.RESERVED, // Thay đổi từ BOOKED sang RESERVED
    );

    // Create notification
    try {
      const hotel = await this.hotelModel.findById(createBookingDto.hotel_id);
      await this.notificationsService.createBookingNotification(
        userId,
        booking.booking_id,
        hotel.name,
      );
    } catch (error) {
      console.error(`Failed to create notification: ${error.message}`);
      // Do not affect the main flow if notification creation fails
    }

    return booking;
  }

  async findAll(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
    filters?: FilterBookingDto,
  ) {
    const { filter, sort, population } = aqp(query);

    // Xóa các query params đặc biệt từ filter
    delete filter.current;
    delete filter.pageSize;
    delete filter.dateRange;
    delete filter.search;
    delete filter.user_id;

    // Xây dựng bộ lọc từ các tham số
    const customFilter: any = { ...filter };

    // Kiểm tra quyền, nếu không phải admin thì chỉ xem booking của mình
    const user = await this.userModel.findById(userId);
    if (user && user.role !== 'ADMIN') {
      customFilter.user_id = new mongoose.Types.ObjectId(userId);
    } else if (filters?.user_id) {
      // Admin có thể filter theo user_id cụ thể
      customFilter.user_id = new mongoose.Types.ObjectId(filters.user_id);
    }

    // Xử lý lọc theo khoảng thời gian check-in
    if (filters?.dateRange) {
      if (filters.dateRange.includes(',') || filters.dateRange.includes('-')) {
        let [startDate, endDate] = filters.dateRange.includes(',')
          ? filters.dateRange.split(',')
          : filters.dateRange.split('-');

        startDate = startDate.trim();
        endDate = endDate ? endDate.trim() : startDate;

        customFilter.check_in_date = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
    }

    // Thêm các điều kiện lọc
    if (filters?.status) {
      customFilter.status = filters.status;
    }

    if (filters?.payment_status) {
      customFilter.payment_status = filters.payment_status;
    }

    if (filters?.deposit_status) {
      customFilter.deposit_status = filters.deposit_status;
    }

    // Xử lý tìm kiếm theo text
    if (filters?.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      customFilter.$or = [
        { booking_id: searchRegex },
        { guest_name: searchRegex },
        { guest_email: searchRegex },
        { guest_phone: searchRegex },
      ];
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
      this.bookingModel
        .find(customFilter)
        .skip(skip)
        .limit(limit)
        .sort(sort as any)
        .populate(population)
        .exec(),
      this.bookingModel.countDocuments(customFilter),
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

  async findOne(id: string, userId?: string) {
    // Check if id is a valid MongoDB ObjectId or a booking_id
    let booking;
    if (mongoose.isValidObjectId(id)) {
      booking = await this.bookingModel.findById(id);
    } else {
      booking = await this.bookingModel.findOne({ booking_id: id });
    }

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if the booking belongs to the user (unless it's an admin)
    if (userId) {
      const user = await this.userModel.findById(userId);
      if (
        user &&
        user.role !== 'ADMIN' &&
        booking.user_id.toString() !== userId
      ) {
        throw new BadRequestException(
          'You do not have permission to view this booking',
        );
      }
    }

    return booking;
  }

  async update(userId: string, updateBookingDto: UpdateBookingDto) {
    const booking = await this.bookingModel.findById(updateBookingDto._id);
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Check if the booking belongs to the user (unless it's an admin)
    const user = await this.userModel.findById(userId);
    if (
      user &&
      user.role !== 'ADMIN' &&
      booking.user_id.toString() !== userId
    ) {
      throw new BadRequestException(
        'You do not have permission to update this booking',
      );
    }

    // Lưu trạng thái booking trước khi cập nhật
    const previousStatus = booking.status;
    const updatedBooking = await this.bookingModel.findByIdAndUpdate(
      updateBookingDto._id,
      { ...updateBookingDto },
      { new: true },
    );

    // Gửi thông báo khi trạng thái booking thay đổi
    try {
      // Lấy thông tin khách sạn
      const hotel = await this.hotelModel.findById(booking.hotel_id);
      const hotelName = hotel?.name || 'Khách sạn';

      // Trường hợp booking được xác nhận
      if (
        previousStatus !== BookingStatus.CONFIRMED &&
        updatedBooking.status === BookingStatus.CONFIRMED
      ) {
        await this.notificationsService.createBookingConfirmedNotification(
          booking.user_id.toString(),
          booking.booking_id,
          hotelName,
        );
      }

      // Trường hợp booking bị hủy
      if (
        previousStatus !== BookingStatus.CANCELED &&
        updatedBooking.status === BookingStatus.CANCELED
      ) {
        await this.notificationsService.createBookingCanceledNotification(
          booking.user_id.toString(),
          booking.booking_id,
          hotelName,
          updatedBooking.cancellation_reason,
        );
      }
    } catch (error) {
      console.error(
        `Failed to create status change notification: ${error.message}`,
      );
      // Không ảnh hưởng đến luồng chính nếu gửi thông báo thất bại
    }

    return updatedBooking;
  }

  async cancel(userId: string, cancelBookingDto: CancelBookingDto) {
    const booking = await this.findOne(cancelBookingDto._id, userId);
    if (booking.status === BookingStatus.CANCELED) {
      throw new BadRequestException('Booking is already canceled');
    }

    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    // Check cancellation policy and deadline
    const canBeCanceled = await this.checkCancellationPolicy(booking);
    if (!canBeCanceled) {
      throw new BadRequestException(
        'Booking cannot be canceled due to cancellation policy',
      );
    }

    // Process refund if deposit was paid
    if (booking.deposit_status === DepositStatus.PAID) {
      await this.processRefund(booking, userId);
    }

    // Update room availability
    const checkInDate = dayjs.utc(booking.check_in_date).startOf('day');
    const checkOutDate = dayjs.utc(booking.check_out_date).startOf('day');

    await this.roomAvailabilityService.bulkUpdateStatus(
      booking.room_id.toString(),
      checkInDate.toDate(),
      checkOutDate.subtract(1, 'day').toDate(),
      RoomStatus.AVAILABLE,
    );

    // Update booking status
    const canceledBooking = await this.bookingModel.findByIdAndUpdate(
      booking._id,
      {
        status: BookingStatus.CANCELED,
        cancellation_reason:
          cancelBookingDto.cancellation_reason || 'Canceled by user',
        cancelled_at: new Date(),
      },
      { new: true },
    );

    // Gửi thông báo hủy đặt phòng
    try {
      const hotel = await this.hotelModel.findById(booking.hotel_id);
      await this.notificationsService.createBookingCanceledNotification(
        booking.user_id.toString(),
        booking.booking_id,
        hotel?.name || 'Khách sạn',
        cancelBookingDto.cancellation_reason,
      );
    } catch (error) {
      console.error(
        `Failed to create cancellation notification: ${error.message}`,
      );
      // Không ảnh hưởng đến luồng chính nếu gửi thông báo thất bại
    }

    return canceledBooking;
  }

  async checkRoomAvailability(
    roomId: string,
    checkInDate: Date,
    checkOutDate: Date,
  ): Promise<boolean> {
    // Chuyển đổi sang sử dụng checkRoomAvailabilityForDateRange để kiểm tra trực tiếp khoảng thời gian
    return this.roomAvailabilityService.checkRoomAvailabilityForDateRange(
      roomId,
      checkInDate,
      checkOutDate,
    );
  }

  private async checkCancellationPolicy(booking: any): Promise<boolean> {
    // Lấy thông tin về khách sạn để kiểm tra chính sách đặt cọc
    const hotel = await this.hotelModel.findById(booking.hotel_id);
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    // Kiểm tra xem khách sạn có cho phép đặt cọc không
    // Nếu không cho phép đặt cọc, không thể hủy đặt phòng
    if (!hotel.accept_deposit) {
      return false;
    }

    // Nếu booking là non-cancelable, không thể hủy
    if (booking.cancellation_policy === CancellationPolicy.NON_CANCELABLE) {
      return false;
    }

    // Kiểm tra thời hạn hủy (2 ngày trước check-in)
    const checkInDate = dayjs.utc(booking.check_in_date);
    const now = dayjs.utc();
    const daysUntilCheckIn = checkInDate.diff(now, 'day');

    // Cho phép hủy nếu còn ít nhất 2 ngày trước check-in
    return daysUntilCheckIn >= 2;
  }

  private async processRefund(booking: any, userId: string) {
    try {
      // Tìm giao dịch thanh toán liên quan đến booking này
      const payment = await this.paymentModel.findOne({
        booking_id: booking.booking_id,
      });

      if (payment) {
        if (payment.payment_method === 'vnpay') {
          // Nếu thanh toán qua VNPay, sử dụng PaymentsService để hoàn tiền qua VNPay
          await this.paymentsService.processRefund(
            payment.transaction_id,
            userId,
          );
        } else if (payment.payment_method === 'wallet') {
          // Nếu thanh toán qua ví, hoàn tiền vào ví
          await this.userModel.findByIdAndUpdate(userId, {
            $inc: { account_balance: booking.deposit_amount },
            $push: {
              transactions: {
                type: 'REFUND',
                amount: booking.deposit_amount,
                description: `Refund for booking ${booking.booking_id}`,
                reference_id: booking._id.toString(),
                created_at: new Date(),
              },
            },
          });
        }
      } else {
        // Nếu không tìm thấy giao dịch thanh toán (trường hợp dữ liệu cũ), hoàn tiền vào ví
        await this.userModel.findByIdAndUpdate(userId, {
          $inc: { account_balance: booking.deposit_amount },
          $push: {
            transactions: {
              type: 'REFUND',
              amount: booking.deposit_amount,
              description: `Refund for booking ${booking.booking_id}`,
              reference_id: booking._id.toString(),
              created_at: new Date(),
            },
          },
        });
      }

      // Update booking payment status
      await this.bookingModel.findByIdAndUpdate(booking._id, {
        payment_status: PaymentStatus.REFUNDED,
      });

      return true;
    } catch (error) {
      console.error('Error processing refund:', error);
      throw new BadRequestException('Failed to process refund');
    }
  }

  async payDeposit(bookingId: string, userId: string, paymentMethod: string) {
    const booking = await this.findOne(bookingId, userId);

    if (booking.status === BookingStatus.CANCELED) {
      throw new BadRequestException('Cannot pay for a canceled booking');
    }

    if (booking.deposit_status === DepositStatus.PAID) {
      throw new BadRequestException('Deposit has already been paid');
    }

    // Handle payment based on the method
    if (paymentMethod === 'wallet') {
      await this.processWalletPayment(
        booking,
        userId,
        booking.deposit_amount,
        true,
      );
    } else {
      // For VNPay or other methods, you would typically return payment URL
      // For demo, we'll just mark it as paid
      await this.bookingModel.findByIdAndUpdate(
        booking._id,
        {
          deposit_status: DepositStatus.PAID,
          payment_status: PaymentStatus.PARTIALLY_PAID,
          status: BookingStatus.CONFIRMED,
        },
        { new: true },
      );
    }

    // Gửi thông báo thanh toán thành công
    try {
      await this.notificationsService.createPaymentReceivedNotification(
        booking.user_id.toString(),
        booking.booking_id,
        booking.deposit_amount,
      );
    } catch (error) {
      console.error(`Failed to create payment notification: ${error.message}`);
      // Không ảnh hưởng đến luồng chính nếu gửi thông báo thất bại
    }

    return this.findOne(bookingId);
  }

  async payRemainingAmount(
    bookingId: string,
    userId: string,
    paymentMethod: string,
  ) {
    const booking = await this.findOne(bookingId, userId);

    if (booking.status === BookingStatus.CANCELED) {
      throw new BadRequestException('Cannot pay for a canceled booking');
    }

    if (booking.deposit_status !== DepositStatus.PAID) {
      throw new BadRequestException(
        'Deposit must be paid before paying the remaining amount',
      );
    }

    if (booking.payment_status === PaymentStatus.PAID) {
      throw new BadRequestException('Payment has already been completed');
    }

    // Handle payment based on the method
    if (paymentMethod === 'wallet') {
      await this.processWalletPayment(
        booking,
        userId,
        booking.remaining_amount,
        false,
      );
    } else {
      // For VNPay or other methods, you would typically return payment URL
      // For demo, we'll just mark it as paid
      await this.bookingModel.findByIdAndUpdate(
        booking._id,
        {
          payment_status: PaymentStatus.PAID,
        },
        { new: true },
      );
    }

    // Gửi thông báo thanh toán thành công
    try {
      await this.notificationsService.createPaymentReceivedNotification(
        booking.user_id.toString(),
        booking.booking_id,
        booking.remaining_amount,
      );
    } catch (error) {
      console.error(`Failed to create payment notification: ${error.message}`);
      // Không ảnh hưởng đến luồng chính nếu gửi thông báo thất bại
    }

    return this.findOne(bookingId);
  }

  private async processWalletPayment(
    booking: any,
    userId: string,
    amount: number,
    isDeposit: boolean,
  ) {
    // Check if user has enough balance
    const user = await this.userModel.findById(userId);
    if (!user || user.account_balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Start a transaction
    const session = await this.bookingModel.db.startSession();
    session.startTransaction();

    try {
      // Deduct amount from user's wallet
      await this.userModel.findByIdAndUpdate(
        userId,
        {
          $inc: { account_balance: -amount },
          $push: {
            transactions: {
              type: 'PAYMENT',
              amount: -amount,
              description: `Payment for booking ${booking.booking_id}`,
              reference_id: booking._id.toString(),
              created_at: new Date(),
            },
          },
        },
        { session },
      );

      // Update booking status
      if (isDeposit) {
        await this.bookingModel.findByIdAndUpdate(
          booking._id,
          {
            deposit_status: DepositStatus.PAID,
            payment_status: PaymentStatus.PARTIALLY_PAID,
            status: BookingStatus.CONFIRMED,
          },
          { session, new: true },
        );
      } else {
        await this.bookingModel.findByIdAndUpdate(
          booking._id,
          {
            payment_status: PaymentStatus.PAID,
          },
          { session, new: true },
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw new BadRequestException('Payment processing failed');
    } finally {
      session.endSession();
    }
  }

  async confirmPaymentAndUpdateRoomStatus(
    bookingId: string,
    paymentType: string,
  ) {
    const booking = await this.bookingModel.findOne({ booking_id: bookingId });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Chỉ cập nhật room status thành BOOKED khi đã thanh toán deposit hoặc full payment
    if (paymentType === 'deposit' || paymentType === 'full_payment') {
      const checkInDate = dayjs.utc(booking.check_in_date).startOf('day');
      const checkOutDate = dayjs.utc(booking.check_out_date).startOf('day');

      await this.roomAvailabilityService.updateRoomStatusAfterPayment(
        booking.room_id.toString(),
        checkInDate.toDate(),
        checkOutDate.subtract(1, 'day').toDate(),
        RoomStatus.BOOKED,
      );

      // Cập nhật trạng thái booking thành CONFIRMED
      await this.bookingModel.findByIdAndUpdate(booking._id, {
        status: BookingStatus.CONFIRMED,
      });
    }

    return { message: 'Room status updated after payment confirmation' };
  }
}
