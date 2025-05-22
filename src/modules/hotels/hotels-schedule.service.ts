import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Hotel } from './schemas/hotel.schema';
import { Review } from '../reviews/schemas/review.schema';
import { HotelSentimentLabel } from '../reviews/schemas/review.schema';

@Injectable()
export class HotelsScheduleService {
  private readonly logger = new Logger(HotelsScheduleService.name);

  constructor(
    @InjectModel(Hotel.name) private hotelModel: Model<Hotel>,
    @InjectModel(Review.name) private reviewModel: Model<Review>,
  ) {}

  /**
   * Task chạy mỗi ngày lúc 0h để cập nhật sentiment_score và sentiment_label cho khách sạn
   */
  @Cron(CronExpression.EVERY_DAY_AT_2PM)
  async updateHotelsSentiment() {
    this.logger.log('Đang cập nhật sentiment cho các khách sạn...');
    try {
      const hotels = await this.hotelModel.find();
      for (const hotel of hotels) {
        // Lấy các review của khách sạn
        const reviews = await this.reviewModel.find({
          hotel_id: hotel._id,
          sentiment: { $ne: null },
        });
        if (reviews.length === 0) continue;

        // Tổng số comment
        const totalReviews = reviews.length;

        // Tính điểm sentiment trung bình (1-5) và chuyển sang thang 1-10
        const avgSentimentRaw =
          reviews.reduce((sum, r) => sum + (r.sentiment || 0), 0) /
          reviews.length;
        const avgSentiment = avgSentimentRaw * 2;

        // Gán label theo thang điểm 1-10
        let label: HotelSentimentLabel;
        if (avgSentiment <= 2) label = HotelSentimentLabel.VERY_BAD;
        else if (avgSentiment <= 4) label = HotelSentimentLabel.BAD;
        else if (avgSentiment <= 5) label = HotelSentimentLabel.AVERAGE;
        else if (avgSentiment <= 6) label = HotelSentimentLabel.SATISFIED;
        else if (avgSentiment <= 7) label = HotelSentimentLabel.VERY_GOOD;
        else if (avgSentiment <= 8) label = HotelSentimentLabel.EXCELLENT;
        else if (avgSentiment <= 9) label = HotelSentimentLabel.WONDERFUL;
        else label = HotelSentimentLabel.PERFECT;

        // Cập nhật vào hotel
        await this.hotelModel.updateOne(
          { _id: hotel._id },
          {
            $set: {
              sentiment_score: avgSentiment,
              sentiment_label: label,
              total_reviews: totalReviews,
            },
          },
        );
      }
      this.logger.log('Đã cập nhật sentiment cho tất cả khách sạn.');
    } catch (error) {
      this.logger.error('Lỗi khi cập nhật sentiment cho khách sạn:', error);
    }
  }
}
