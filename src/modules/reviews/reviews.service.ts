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
    private sentimentService: SentimentService,
  ) {}

  async create(userId: string, createReviewDto: CreateReviewDto) {
    // Check if hotel exists
    const hotel = await this.hotelModel.findById(createReviewDto.hotel_id);
    if (!hotel) {
      throw new NotFoundException('Hotel not found');
    }

    // Generate unique review ID
    const reviewId = `RV-${uuidv4().substring(0, 8)}`;

    // Analyze sentiment if the service is available
    let sentiment = null;
    let sentimentLabel = null;

    try {
      const sentimentResult = await this.sentimentService.analyzeSentiment(
        createReviewDto.review_text,
      );
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

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort, projection, population } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

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
      .populate(population || ['user_id', 'hotel_id'])
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

  async findByHotel(
    hotelId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    if (!mongoose.isValidObjectId(hotelId)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    // Add hotel_id to query filter
    const parsedQuery = aqp(query);
    parsedQuery.filter.hotel_id = hotelId;

    return this.findAll(JSON.stringify(parsedQuery), current, pageSize);
  }

  async findByUser(
    userId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    // Add user_id to query filter
    const parsedQuery = aqp(query);
    parsedQuery.filter.user_id = userId;

    return this.findAll(JSON.stringify(parsedQuery), current, pageSize);
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
        const sentimentResult = await this.sentimentService.analyzeSentiment(
          updateReviewDto.review_text,
        );
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
}
