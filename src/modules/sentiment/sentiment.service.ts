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
    // Measure processing time
    const startTime = Date.now();

    try {
      // In a real application, you would call an external sentiment analysis API
      // For demo purposes, we'll use a simple sentiment algorithm

      // Example of calling an external AI service (commented out)
      // const apiKey = this.configService.get<string>('SENTIMENT_API_KEY');
      // const response = await axios.post('https://api.sentiment-analysis.example/analyze', {
      //   text,
      //   language: 'vi'
      // }, {
      //   headers: {
      //     'Authorization': `Bearer ${apiKey}`
      //   }
      // });
      //
      // const score = response.data.score;
      // const label = this.getSentimentLabel(score);
      // const keywords = response.data.keywords || [];

      // Simple simulation of sentiment analysis
      const score = this.simulateSentimentAnalysis(text);
      const label = this.getSentimentLabel(score);
      const keywords = this.extractKeywords(text);
      const confidence = 0.85;

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      // Save the sentiment analysis log
      await this.saveSentimentLog({
        review_id: reviewId,
        original_text: text,
        processed_text: text,
        sentiment_score: score,
        sentiment_label: label,
        confidence,
        model_version: 'sentiment-vi-v1.0',
        processing_time_ms: processingTime,
        keywords,
      });

      return {
        score,
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

  private simulateSentimentAnalysis(text: string): number {
    // This is a very simple sentiment simulation
    // In a real app, use a proper NLP service
    const positiveWords = [
      'tuyệt vời',
      'tốt',
      'hài lòng',
      'thích',
      'sạch sẽ',
      'tiện nghi',
      'thân thiện',
      'thoải mái',
      'ngon',
      'đẹp',
    ];

    const negativeWords = [
      'tệ',
      'kém',
      'bẩn',
      'không hài lòng',
      'thất vọng',
      'chật',
      'ồn',
      'đắt',
      'chậm',
      'xấu',
    ];

    // Count positive and negative words
    let posCount = 0;
    let negCount = 0;

    // Convert to lowercase for word matching
    const lowerText = text.toLowerCase();

    positiveWords.forEach((word) => {
      if (lowerText.includes(word)) posCount++;
    });

    negativeWords.forEach((word) => {
      if (lowerText.includes(word)) negCount++;
    });

    // Calculate base score (0-10)
    const textLength = text.split(' ').length;
    let score = 5; // Neutral starting point

    if (textLength > 0) {
      // Adjust score based on positive vs negative words
      const factor = 2.5 * ((posCount - negCount) / textLength);
      score += factor;
    }

    // Ensure score is between 0 and 10
    return Math.max(0, Math.min(10, score));
  }

  private getSentimentLabel(score: number): SentimentLabel {
    if (score < 4.0) return SentimentLabel.NEGATIVE;
    if (score < 6.5) return SentimentLabel.NEUTRAL;
    if (score < 8.0) return SentimentLabel.SATISFIED;
    if (score < 9.0) return SentimentLabel.EXCELLENT;
    return SentimentLabel.PERFECT;
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
    const wordPairs = Object.entries(wordFrequency).sort((a, b) => (b[1] as number) - (a[1] as number));

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
