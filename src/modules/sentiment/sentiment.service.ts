import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SentimentLog } from './schemas/sentiment-log.schema';
import { SentimentLabel } from '../reviews/schemas/review.schema';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SentimentService {
  private readonly logger = new Logger(SentimentService.name);

  constructor(
    @InjectModel(SentimentLog.name)
    private sentimentLogModel: Model<SentimentLog>,
    private configService: ConfigService,
  ) {}

  async analyzeSentiment(
    text: string,
    reviewId?: string,
  ): Promise<{
    score: number;
    label: SentimentLabel;
    keywords: string[];
  }> {
    const startTime = Date.now();

    try {
      // Lấy AI API URL từ biến môi trường
      const aiApiUrl =
        this.configService.get<string>('AI_API_URL') || 'http://127.0.0.1:8000';
      const response = await axios.post(`${aiApiUrl}/analyze-single`, {
        review_text: text,
      });

      const data = response.data;

      // Map sentiment_label từ API về SentimentLabel enum
      let label: SentimentLabel;
      switch (data.sentiment_label) {
        case 'very_negative':
          label = SentimentLabel.VERY_NEGATIVE;
          break;
        case 'negative':
          label = SentimentLabel.NEGATIVE;
          break;
        case 'neutral':
          label = SentimentLabel.NEUTRAL;
          break;
        case 'positive':
          label = SentimentLabel.POSITIVE;
          break;
        case 'very_positive':
          label = SentimentLabel.VERY_POSITIVE;
          break;
        default:
          label = SentimentLabel.NEUTRAL;
      }

      // Xử lý keywords từ processed_text (nếu cần)
      const keywords = this.extractKeywords(data.processed_text);

      // Lưu log phân tích sentiment
      await this.saveSentimentLog({
        review_id: reviewId,
        original_text: data.review_text,
        processed_text: data.processed_text,
        sentiment_score: data.predicted_rating,
        sentiment_label: label,
        confidence: data.confidence,
        model_version: data.model_version,
        processing_time_ms: data.processing_time_ms ?? Date.now() - startTime,
        keywords,
      });

      return {
        score: data.predicted_rating,
        label,
        keywords,
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing sentiment: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - in real app use proper NLP
    const stopWords = ['và', 'của', 'là', 'trong', 'với', 'có', 'được'];

    // Tokenize the text into words
    const words = text
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .split(/\s+/);

    // Remove stop words
    const filteredWords = words.filter(
      (word) => word.length > 3 && !stopWords.includes(word),
    );

    // Count word frequencies
    const wordFrequency = {};
    filteredWords.forEach((word) => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    });

    // Convert to array of [word, frequency] pairs and sort by frequency
    const wordPairs = Object.entries(wordFrequency).sort(
      (a, b) => (b[1] as number) - (a[1] as number),
    );

    // Return top keywords (up to 5)
    return wordPairs.slice(0, 5).map((pair) => pair[0]);
  }

  private async saveSentimentLog(data: {
    review_id?: string;
    original_text: string;
    processed_text: string;
    sentiment_score: number;
    sentiment_label: SentimentLabel;
    confidence: number;
    model_version: string;
    processing_time_ms: number;
    keywords: string[];
  }) {
    try {
      await this.sentimentLogModel.create(data);
    } catch (error) {
      this.logger.error(
        `Error saving sentiment log: ${error.message}`,
        error.stack,
      );
      // Don't throw error here to prevent affecting the main flow
    }
  }
}
