import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateResponseDto, UpdateReviewDto } from './dto/update-review.dto';
import { Review, SentimentLabel } from './schemas/review.schema';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../users/schemas/user.schema';
import { Booking } from '../bookings/schemas/booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { SentimentService } from '@/modules/sentiment/sentiment.service';
import aqp from 'api-query-params';
import mongoose from 'mongoose';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Hotel.name) private hotelModel: Model<Hotel>,
    @InjectModel(Booking.name) private bookingModel: Model<Booking>, // Import Booking model
    private sentimentService: SentimentService,
  ) {}

  async create(userId: string, createReviewDto: CreateReviewDto) {
    // Check if hotel exists
    const hotel = await this.hotelModel.findById(createReviewDto.hotel_id);
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    // Kiểm tra xem người dùng đã từng đặt phòng tại khách sạn này chưa
    // và đã qua thời gian checkout hay chưa
    const canReview = await this.verifyUserCanReviewHotel(
      userId,
      createReviewDto.hotel_id,
    );

    console.log('User can review:', canReview);

    if (!canReview) {
      throw new BadRequestException(
        'You can only review hotels after completing your stay',
      );
    }

    // Generate unique review ID
    const reviewId = `RV-${uuidv4().substring(0, 8)}`;

    // Analyze sentiment if the service is available
    let sentiment = null;
    let sentimentLabel = null;

    try {
      // Detect language and translate to English if needed
      const englishText = await this.translateToEnglishIfNeeded(
        createReviewDto.review_text,
      );

      console.log('Review text in English:', englishText);

      const sentimentResult =
        await this.sentimentService.analyzeSentiment(englishText);
      sentiment = sentimentResult.score;
      sentimentLabel = sentimentResult.label;
    } catch (error) {
      console.error('Sentiment analysis failed:', error);
      // Continue without sentiment if analysis fails
    }

    // Create review
    const review = await this.reviewModel.create({
      review_id: reviewId,
      user_id: userId,
      hotel_id: createReviewDto.hotel_id,
      rating: createReviewDto.rating,
      review_text: createReviewDto.review_text,
      sentiment,
      sentiment_label: sentimentLabel,
    });

    // Update hotel's average rating
    await this.updateHotelAverageRating(createReviewDto.hotel_id);

    return review;
  }

  async findAll(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
    filters?: {
      dateRange?: string;
      sentiment_label?: string;
      rating?: string;
      search?: string;
    },
  ) {
    const { filter, sort, population } = aqp(query);

    // Xóa các query params đặc biệt từ filter
    delete filter.current;
    delete filter.pageSize;
    delete filter.dateRange;
    delete filter.search;

    // Xây dựng bộ lọc từ các tham số
    const customFilter: any = { ...filter };

    // Nếu không phải admin thì chỉ xem review của mình
    // (Nếu muốn lọc theo user_id, bổ sung logic kiểm tra quyền ở đây)
    if (userId) {
      // Lấy user để kiểm tra quyền
      const user = await this.userModel.findById(userId);
      if (user && user.role !== 'ADMIN') {
        customFilter.user_id = new mongoose.Types.ObjectId(userId);
      }
    }

    // Lọc theo khoảng thời gian tạo review
    if (filters?.dateRange) {
      if (filters.dateRange.includes(',') || filters.dateRange.includes('-')) {
        let [startDate, endDate] = filters.dateRange.includes(',')
          ? filters.dateRange.split(',')
          : filters.dateRange.split('-');

        startDate = startDate.trim();
        endDate = endDate ? endDate.trim() : startDate;

        customFilter.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }
    }

    // Lọc theo sentiment_label
    if (filters?.sentiment_label) {
      customFilter.sentiment_label = filters.sentiment_label;
    }

    // Lọc theo rating
    if (filters?.rating) {
      customFilter.rating = Number(filters.rating);
    }

    // Xử lý tìm kiếm theo text
    if (filters?.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      customFilter.$or = [{ review_text: searchRegex }];
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
      this.reviewModel
        .find(customFilter)
        .skip(skip)
        .limit(limit)
        .sort(sort as any)
        .populate(population)
        .exec(),
      this.reviewModel.countDocuments(customFilter),
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

  async findByHotel(
    hotelId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    if (!mongoose.isValidObjectId(hotelId)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    // Tạo filter với hotel_id là ObjectId
    const filter = { hotel_id: new mongoose.Types.ObjectId(hotelId) };

    // Lấy các tham số phụ từ query nếu có
    const parsedQuery = aqp(query);
    const sort = parsedQuery.sort || { createdAt: -1 };
    const population = parsedQuery.population || ['user_id'];

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.reviewModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.reviewModel
      .find(filter)
      .limit(pageSize)
      .skip(skip)
      .sort(sort as any)
      .populate(population);

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

  async findByUser(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    // Thay vào đó, xây dựng filter thủ công
    const filter = { user_id: new mongoose.Types.ObjectId(userId) };

    // Lấy các tham số phụ từ query nếu có
    const parsedQuery = aqp(query);
    const sort = parsedQuery.sort || { createdAt: -1 };

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.reviewModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.reviewModel
      .find(filter)
      .limit(pageSize)
      .skip(skip)
      .sort(sort as any)
      .populate(['user_id', 'hotel_id']);

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

  async findOne(id: string) {
    let review;

    if (mongoose.isValidObjectId(id)) {
      review = await this.reviewModel
        .findById(id)
        .populate(['user_id', 'hotel_id']);
    } else {
      review = await this.reviewModel
        .findOne({ review_id: id })
        .populate(['user_id', 'hotel_id']);
    }

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    return review;
  }

  async update(userId: string, updateReviewDto: UpdateReviewDto) {
    const review = await this.reviewModel.findById(updateReviewDto._id);
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Verify ownership or admin status
    const user = await this.userModel.findById(userId);
    if (user.role !== 'ADMIN' && review.user_id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to update this review',
      );
    }

    // If review text changed, re-analyze sentiment
    if (
      updateReviewDto.review_text &&
      updateReviewDto.review_text !== review.review_text
    ) {
      try {
        // Detect language and translate to English if needed
        const englishText = await this.translateToEnglishIfNeeded(
          updateReviewDto.review_text,
        );

        const sentimentResult =
          await this.sentimentService.analyzeSentiment(englishText);
        updateReviewDto['sentiment'] = sentimentResult.score;
        updateReviewDto['sentiment_label'] = sentimentResult.label;
      } catch (error) {
        console.error('Sentiment analysis failed:', error);
        // Continue without updating sentiment if analysis fails
      }
    }

    const updatedReview = await this.reviewModel.findByIdAndUpdate(
      updateReviewDto._id,
      updateReviewDto,
      { new: true },
    );

    // Update hotel's average rating
    if (updateReviewDto.rating) {
      await this.updateHotelAverageRating(review.hotel_id.toString());
    }

    return updatedReview;
  }

  async createResponse(userId: string, createResponseDto: CreateResponseDto) {
    // Find the review
    const review = await this.findOne(createResponseDto.review_id);

    // Check if user is hotel admin or system admin
    const user = await this.userModel.findById(userId);
    if (user.role !== 'ADMIN') {
      throw new BadRequestException(
        'You do not have permission to respond to this review',
      );
    }

    // Update review with response
    const updatedReview = await this.reviewModel.findByIdAndUpdate(
      review._id,
      {
        response: {
          response_text: createResponseDto.response_text,
          response_by: userId,
          response_date: new Date(),
        },
      },
      { new: true },
    );

    return updatedReview;
  }

  async remove(userId: string, id: string) {
    let review;

    if (mongoose.isValidObjectId(id)) {
      review = await this.reviewModel.findById(id);
    } else {
      review = await this.reviewModel.findOne({ review_id: id });
    }

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    // Verify ownership or admin status
    const user = await this.userModel.findById(userId);
    if (user.role !== 'ADMIN' && review.user_id.toString() !== userId) {
      throw new BadRequestException(
        'You do not have permission to delete this review',
      );
    }

    // Delete the review
    await this.reviewModel.findByIdAndDelete(review._id);

    // Update hotel's average rating
    await this.updateHotelAverageRating(review.hotel_id.toString());

    return { deleted: true };
  }

  private async updateHotelAverageRating(hotelId: string) {
    // Calculate average rating for the hotel
    const aggregateResult = await this.reviewModel.aggregate([
      { $match: { hotel_id: new mongoose.Types.ObjectId(hotelId) } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          averageSentiment: { $avg: '$sentiment' },
          count: { $sum: 1 },
        },
      },
    ]);

    if (aggregateResult.length > 0) {
      const { averageRating, averageSentiment, count } = aggregateResult[0];

      // Update hotel with new average rating and sentiment
      await this.hotelModel.findByIdAndUpdate(hotelId, {
        rating: averageRating,
        'ai_summary.average_sentiment': averageSentiment,
        'ai_summary.last_updated': new Date(),
      });
    }
  }

  // Cập nhật phương thức để kiểm tra khả năng đánh giá với nhiều điều kiện hơn
  private async verifyUserCanReviewHotel(
    userId: string,
    hotelId: string,
  ): Promise<boolean> {
    // Lấy thời gian hiện tại theo UTC+7
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);

    // Kiểm tra xem người dùng đã đánh giá khách sạn này chưa
    const existingReview = await this.reviewModel.findOne({
      user_id: userId,
      hotel_id: hotelId,
    });

    if (existingReview) {
      console.log(`User ${userId} has already reviewed hotel ${hotelId}`);
      return false; // Người dùng đã đánh giá khách sạn này rồi
    }

    // Tạo thời gian so sánh
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayNoon = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      0,
      0,
    );

    // Tìm booking của user tại hotel này đã checkout
    const completedBooking = await this.bookingModel.findOne({
      user_id: userId,
      hotel_id: hotelId,
      status: 'completed', // Booking đã hoàn thành (không phải đã hủy)
    });

    if (!completedBooking) {
      return false; // Không tìm thấy booking hoàn thành nào
    }

    const checkoutDate = new Date(completedBooking.check_out_date);
    const checkoutDateStart = new Date(
      checkoutDate.getFullYear(),
      checkoutDate.getMonth(),
      checkoutDate.getDate(),
    );
    const checkoutDateNoon = new Date(
      checkoutDate.getFullYear(),
      checkoutDate.getMonth(),
      checkoutDate.getDate(),
      12,
      0,
      0,
    );

    // Kiểm tra điều kiện checkout
    let canReviewBasedOnTime = false;

    // Điều kiện 1: Ngày check-out đã qua hoàn toàn
    if (checkoutDate < todayStart) {
      canReviewBasedOnTime = true;
    }
    // Điều kiện 2: Ngày check-out là hôm nay và đã qua 12h trưa
    else if (
      checkoutDateStart.getTime() === todayStart.getTime() &&
      now >= checkoutDateNoon
    ) {
      console.log('Condition 2: Checkout date is today and past 12 PM');
      canReviewBasedOnTime = true;
    }

    if (!canReviewBasedOnTime) {
      return false;
    }

    // Kiểm tra thời hạn đánh giá (30 ngày sau checkout)
    const reviewDeadline = new Date(checkoutDate);
    reviewDeadline.setDate(reviewDeadline.getDate() + 30);

    if (now > reviewDeadline) {
      console.log(
        `Review period has expired for booking ${completedBooking._id}`,
      );
      return false; // Đã quá hạn 30 ngày để đánh giá
    }

    return true;
  }

  private async translateToEnglishIfNeeded(text: string): Promise<string> {
    try {
      // Simple language detection - check for Vietnamese characters
      const vietnamesePattern =
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/;

      // If text contains Vietnamese characters, translate to English
      if (vietnamesePattern.test(text)) {
        console.log('Vietnamese text detected, translating to English...');

        // Use Google Translate API or similar service
        const translatedText = await this.translateText(text, 'vi', 'en');
        console.log('Original text:', text);
        console.log('Translated text:', translatedText);

        return translatedText;
      }

      // If text appears to be English, return as is
      return text;
    } catch (error) {
      console.error('Translation failed, using original text:', error);
      return text; // Fallback to original text if translation fails
    }
  }

  private async translateText(
    text: string,
    fromLang: string,
    toLang: string,
  ): Promise<string> {
    try {
      // Using MyMemory API (free, no API key required)
      const axios = require('axios');

      const response = await axios.get(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`,
      );

      console.log('MyMemory API response:', response.data);

      if (response.data && response.data.responseData) {
        return response.data.responseData.translatedText;
      }

      throw new Error('Translation API response invalid');
    } catch (error) {
      console.error('MyMemory API error:', error);

      // Fallback: Simple word replacement for common Vietnamese words
      return this.simpleVietnameseToEnglish(text);
    }
  }

  private simpleVietnameseToEnglish(text: string): string {
    const commonTranslations = {
      tốt: 'good',
      xấu: 'bad',
      'tuyệt vời': 'excellent',
      'rất tốt': 'very good',
      'không tốt': 'not good',
      'dịch vụ': 'service',
      phòng: 'room',
      'sạch sẽ': 'clean',
      bẩn: 'dirty',
      'nhân viên': 'staff',
      'thân thiện': 'friendly',
      'giá cả': 'price',
      đắt: 'expensive',
      rẻ: 'cheap',
      'khách sạn': 'hotel',
      'ăn sáng': 'breakfast',
      'điều hòa': 'air conditioning',
    };

    let translatedText = text.toLowerCase();

    Object.entries(commonTranslations).forEach(([vietnamese, english]) => {
      const regex = new RegExp(vietnamese, 'gi');
      translatedText = translatedText.replace(regex, english);
    });

    return translatedText;
  }
}
