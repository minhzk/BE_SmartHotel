import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  console.log('🚀 Starting SmartHotel Backend...');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get('PORT');

  console.log('✅ NestJS app created');

  // Increase payload size limit for base64 image uploads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api/v1', { exclude: [''] });
  console.log('✅ Global prefix set to api/v1');

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('SmartHotel API')
    .setDescription('API documentation for SmartHotel')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // config cors
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    credentials: true,
  });
  console.log('✅ CORS enabled');

  await app.listen(port);

  console.log(`🎉 Application running on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/api/v1/health`);
  console.log(`📡 API endpoint: http://localhost:${port}/api/v1`);
  console.log(`✅ Swagger docs available at http://localhost:${port}/api-docs`);

}
bootstrap();
