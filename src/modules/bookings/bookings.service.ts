import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { RoomStatus } from '../room-availability/schemas/room-availability.schema';
import { User } from '../users/schemas/user.schema';
import { Room } from '../rooms/schemas/room.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import mongoose from 'mongoose';
import aqp from 'api-query-params';

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
    private readonly roomAvailabilityService: RoomAvailabilityService,
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
      checkOutDate.toDate(),
    );

    if (!isRoomAvailable) {
      throw new BadRequestException(
        'Room is not available for the specified dates',
      );
    }

    // Calculate number of nights
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

    // Create booking
    const booking = await this.bookingModel.create({
      booking_id: bookingId,
      user_id: userId,
      hotel_id: createBookingDto.hotel_id,
      room_id: createBookingDto.room_id,
      check_in_date: checkInDate.toDate(),
      check_out_date: checkOutDate.toDate(),
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
      guest_name: createBookingDto.guest_name,
      guest_email: createBookingDto.guest_email,
      guest_phone: createBookingDto.guest_phone,
      special_requests: createBookingDto.special_requests,
      number_of_guests: createBookingDto.number_of_guests || 1,
    });

    // Mark the room as booked for the date range
    await this.roomAvailabilityService.bulkUpdateStatus(
      createBookingDto.room_id,
      checkInDate.toDate(),
      checkOutDate.subtract(1, 'day').toDate(), // Not including checkout day
      RoomStatus.BOOKED,
    );

    return booking;
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

    // Add user_id filter for regular users, not needed for ADMIN
    const user = await this.userModel.findById(userId);
    if (user && user.role !== 'ADMIN') {
      filter.user_id = userId;
    }

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.bookingModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.bookingModel
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

    return await this.bookingModel.findByIdAndUpdate(
      updateBookingDto._id,
      { ...updateBookingDto },
      { new: true },
    );
  }

  async cancel(userId: string, cancelBookingDto: CancelBookingDto) {
    const booking = await this.findOne(cancelBookingDto.booking_id, userId);
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
    return await this.bookingModel.findByIdAndUpdate(
      booking._id,
      {
        status: BookingStatus.CANCELED,
        cancellation_reason:
          cancelBookingDto.cancellation_reason || 'Canceled by user',
        cancelled_at: new Date(),
      },
      { new: true },
    );
  }

  async checkRoomAvailability(
    roomId: string,
    checkInDate: Date,
    checkOutDate: Date,
  ): Promise<boolean> {
    // Convert dates to dayjs objects for easier manipulation
    const startDate = dayjs.utc(checkInDate).startOf('day');
    const endDate = dayjs.utc(checkOutDate).subtract(1, 'day').startOf('day'); // Exclude check-out day

    // Check each day in the range
    let currentDate = startDate;
    while (
      currentDate.isBefore(endDate) ||
      currentDate.isSame(endDate, 'day')
    ) {
      const isAvailable =
        await this.roomAvailabilityService.checkRoomAvailability(
          roomId,
          currentDate.toDate(),
        );
      if (!isAvailable) {
        return false;
      }
      currentDate = currentDate.add(1, 'day');
    }

    return true;
  }

  private async checkCancellationPolicy(booking: any): Promise<boolean> {
    // If booking is non-cancelable, it can't be canceled
    if (booking.cancellation_policy === CancellationPolicy.NON_CANCELABLE) {
      return false;
    }

    // Check cancellation deadline (e.g., 24 hours before check-in)
    const checkInDate = dayjs.utc(booking.check_in_date);
    const now = dayjs.utc();
    const hoursUntilCheckIn = checkInDate.diff(now, 'hour');

    // Allow cancellation if more than 24 hours before check-in
    return hoursUntilCheckIn >= 24;
  }

  private async processRefund(booking: any, userId: string) {
    // In a real system, this would call payment provider's refund API
    // For our system, we'll credit the user's wallet

    try {
      // Add refund amount to user's wallet
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
}
