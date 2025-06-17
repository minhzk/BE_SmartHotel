import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingStatus } from '../bookings/schemas/booking.schema';
import { User } from '../users/schemas/user.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { Payment } from '../payments/schemas/payment.schema';
import dayjs from 'dayjs';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Booking.name) private bookingModel: Model<Booking>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Hotel.name) private hotelModel: Model<Hotel>,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
  ) {}

  async getOverviewStats() {
    const now = new Date();
    const lastMonth = dayjs().subtract(1, 'month').toDate();

    // Calculate total revenue
    const revenueAgg = await this.paymentModel.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // Calculate revenue growth
    const lastMonthRevenue = await this.paymentModel.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: {
            $gte: lastMonth,
            $lt: dayjs().subtract(1, 'month').add(1, 'month').toDate(),
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const lastMonthTotal = lastMonthRevenue[0]?.total || 0;
    const revenueGrowth =
      lastMonthTotal > 0
        ? ((totalRevenue - lastMonthTotal) / lastMonthTotal) * 100
        : 0;

    // Total bookings
    const totalBookings = await this.bookingModel.countDocuments();
    const lastMonthBookings = await this.bookingModel.countDocuments({
      createdAt: {
        $gte: lastMonth,
        $lt: dayjs().subtract(1, 'month').add(1, 'month').toDate(),
      },
    });
    const bookingGrowth =
      lastMonthBookings > 0
        ? ((totalBookings - lastMonthBookings) / lastMonthBookings) * 100
        : 0;

    // Total users and hotels
    const totalUsers = await this.userModel.countDocuments();
    const totalHotels = await this.hotelModel.countDocuments();

    return {
      totalRevenue,
      totalBookings,
      totalUsers,
      totalHotels,
      revenueGrowth: Math.round(revenueGrowth * 100) / 100,
      bookingGrowth: Math.round(bookingGrowth * 100) / 100,
    };
  }

  async getRevenueStats(params: {
    startDate: string;
    endDate: string;
    period: string;
  }) {
    const { startDate, endDate, period } = params;
    const start = new Date(startDate);
    const end = new Date(endDate);

    let groupFormat;
    switch (period) {
      case 'day':
        groupFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupFormat = '%Y-%U';
        break;
      case 'month':
        groupFormat = '%Y-%m';
        break;
      default:
        groupFormat = '%Y-%m-%d';
    }

    const revenueStats = await this.paymentModel.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
          revenue: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return revenueStats.map((item) => ({
      date: item._id,
      revenue: item.revenue,
    }));
  }

  async getBookingStats(params: {
    startDate: string;
    endDate: string;
    period: string;
  }) {
    const { startDate, endDate, period } = params;
    const start = new Date(startDate);
    const end = new Date(endDate);

    let groupFormat;
    switch (period) {
      case 'day':
        groupFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupFormat = '%Y-%U';
        break;
      case 'month':
        groupFormat = '%Y-%m';
        break;
      default:
        groupFormat = '%Y-%m-%d';
    }

    const bookingStats = await this.bookingModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: groupFormat, date: '$createdAt' },
            },
            status: '$status',
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          bookings: { $sum: '$count' },
          completedBookings: {
            $sum: {
              $cond: [
                { $eq: ['$_id.status', BookingStatus.COMPLETED] },
                '$count',
                0,
              ],
            },
          },
          cancelledBookings: {
            $sum: {
              $cond: [
                { $eq: ['$_id.status', BookingStatus.CANCELED] },
                '$count',
                0,
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return bookingStats.map((item) => ({
      date: item._id,
      bookings: item.bookings,
      completedBookings: item.completedBookings,
      cancelledBookings: item.cancelledBookings,
    }));
  }

  async getHotelsByCity() {
    const cityStats = await this.hotelModel.aggregate([
      {
        $group: {
          _id: '$city',
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {};
    cityStats.forEach((item) => {
      result[item._id] = item.count;
    });

    return result;
  }

  async getTopHotels(params: { limit: number }) {
    const { limit } = params;

    const topHotels = await this.paymentModel.aggregate([
      { $match: { status: 'completed' } },
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking_id',
          foreignField: 'booking_id',
          as: 'booking',
        },
      },
      { $unwind: '$booking' },
      {
        $lookup: {
          from: 'hotels',
          localField: 'booking.hotel_id',
          foreignField: '_id',
          as: 'hotel',
        },
      },
      { $unwind: '$hotel' },
      {
        $group: {
          _id: '$hotel._id',
          name: { $first: '$hotel.name' },
          revenue: { $sum: '$amount' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);

    return topHotels;
  }

  async getUserStats(params: {
    startDate: string;
    endDate: string;
    period: string;
  }) {
    const { startDate, endDate, period } = params;
    const start = new Date(startDate);
    const end = new Date(endDate);

    let groupFormat;
    switch (period) {
      case 'day':
        groupFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupFormat = '%Y-%U';
        break;
      case 'month':
        groupFormat = '%Y-%m';
        break;
      default:
        groupFormat = '%Y-%m-%d';
    }

    const userStats = await this.userModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: '$createdAt' } },
          newUsers: { $sum: 1 },
          activeUsers: {
            $sum: {
              $cond: [{ $eq: ['$isActive', true] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return userStats.map((item) => ({
      date: item._id,
      newUsers: item.newUsers,
      activeUsers: item.activeUsers,
    }));
  }
}
