import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SentimentService } from './sentiment.service';
import {
  SentimentLog,
  SentimentLogSchema,
} from './schemas/sentiment-log.schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SentimentLog.name, schema: SentimentLogSchema },
    ]),
    ConfigModule,
  ],
  providers: [SentimentService],
  exports: [SentimentService],
})
export class SentimentModule {}
