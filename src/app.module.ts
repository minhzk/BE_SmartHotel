import { Module } from '@nestjs/common';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { UsersModule } from '@/modules/users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '@/auth/auth.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './auth/passport/jwt-auth.guard';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { TransformInterceptor } from './core/transform.interceptor';
import { HotelsModule } from '@/modules/hotels/hotels.module';
import { RoomsModule } from '@/modules/rooms/rooms.module';
import { RoomAvailabilityModule } from '@/modules/room-availability/room-availability.module';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { ReviewsModule } from '@/modules/reviews/reviews.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { SentimentModule } from '@/modules/sentiment/sentiment.module';
import { ChatbotModule } from '@/modules/chatbot/chatbot.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { FavoritesModule } from './modules/favorites/favorites.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASSWORD'),
          },
          tls: {
            rejectUnauthorized: false,
          },
        },
        defaults: {
          from: '"Smart Hotel" <no-reply@smarthotel.com>',
        },
        template: {
          dir: process.cwd() + '/src/mail/templates/',
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
    HotelsModule,
    RoomsModule,
    RoomAvailabilityModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    NotificationsModule,
    SentimentModule,
    ChatbotModule,
    EventEmitterModule.forRoot(),
    CloudinaryModule,
    FavoritesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
