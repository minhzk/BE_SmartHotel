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

    // Check if booking exists and belongs to user
    const booking = await this.bookingModel.findById(
      createReviewDto.booking_id,
    );
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.user_id.toString() !== userId) {
      throw new BadRequestException('Booking does not belong to you');
    }

    if (booking.hotel_id.toString() !== createReviewDto.hotel_id) {
      throw new BadRequestException('Booking does not match the hotel');
    }

    // Kiểm tra xem đã đánh giá booking này chưa
    const existingReview = await this.reviewModel.findOne({
      user_id: userId,
      booking_id: createReviewDto.booking_id,
    });

    if (existingReview) {
      throw new BadRequestException('You have already reviewed this booking');
    }

    // Kiểm tra xem người dùng có thể đánh giá booking này không
    const canReview = await this.verifyUserCanReviewBooking(
      userId,
      createReviewDto.booking_id,
    );

    if (!canReview) {
      throw new BadRequestException(
        'You can only review bookings after completing your stay',
      );
    }

    // Generate unique review ID
    const reviewId = `RV-${uuidv4().substring(0, 8)}`;

    // Analyze sentiment if the service is available
    let sentiment = null;
    let sentimentLabel = null;

    try {
      // Detect language and translate to English if needed
      const englishText = await this.correctSpellingAndTranslate(
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
      booking_id: createReviewDto.booking_id,
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
        const englishText = await this.correctSpellingAndTranslate(
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

  // Cập nhật phương thức để kiểm tra khả năng đánh giá theo booking
  private async verifyUserCanReviewBooking(
    userId: string,
    bookingId: string,
  ): Promise<boolean> {
    // Lấy thời gian hiện tại theo UTC+7
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);

    // Kiểm tra xem người dùng đã đánh giá booking này chưa
    const existingReview = await this.reviewModel.findOne({
      user_id: userId,
      booking_id: bookingId,
    });

    if (existingReview) {
      console.log(`User ${userId} has already reviewed booking ${bookingId}`);
      return false; // Người dùng đã đánh giá booking này rồi
    }

    // Tạo thời gian so sánh
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    // Tìm booking cụ thể
    const booking = await this.bookingModel.findById(bookingId);

    if (!booking) {
      return false; // Không tìm thấy booking
    }

    // Kiểm tra booking thuộc về user
    if (booking.user_id.toString() !== userId) {
      return false; // Booking không thuộc về user này
    }

    // Kiểm tra booking đã hoàn thành
    if (booking.status !== 'completed') {
      return false; // Booking chưa hoàn thành
    }

    const checkoutDate = new Date(booking.check_out_date);
    const checkoutDateStart = new Date(
      checkoutDate.getFullYear(),
      checkoutDate.getMonth(),
      checkoutDate.getDate(),
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
      now >=
        new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0)
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
      console.log(`Review period has expired for booking ${booking._id}`);
      return false; // Đã quá hạn 30 ngày để đánh giá
    }

    return true;
  }

  private async correctSpellingAndTranslate(text: string): Promise<string> {
    const axios = require('axios');
    const apiKey = process.env.OPENAI_API_KEY;
    const modelVersion = process.env.OPENAI_MODEL;

    try {
      const systemPrompt = `
        You are a multilingual assistant. Your task is:
        1. Detect the input language.
        2. Fix spelling and grammar mistakes in that language (if any).
        3. If the corrected sentence is not in English, translate it to English.
        4. Return the result as a JSON object with these fields:
        {
          "original": "<original_input>",
          "corrected": "<corrected_input_same_language>",
          "translated": "<final_english_translation>"
        }
        Do not include any extra explanation or formatting. Only return the pure JSON.
            `;

      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: modelVersion,
          messages: [
            {
              role: 'system',
              content: systemPrompt.trim(),
            },
            {
              role: 'user',
              content: `Input: "${text}"`,
            },
          ],
          temperature: 0.2,
          max_tokens: 512,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      const raw = response.data.choices[0]?.message?.content?.trim();
      const json = JSON.parse(raw);

      console.log('📝 Original:', json.original);
      console.log('✅ Corrected:', json.corrected);
      console.log('🌐 Translated:', json.translated);

      return json.translated || text;
    } catch (error) {
      console.error('OpenAI correction/translation error:', error.response?.data || error.message);
      return text;
    }
  }


}
