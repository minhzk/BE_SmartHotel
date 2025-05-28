import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from '@/decorator/customize';


@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  getHealth() {
    return {
      status: 'healthy',
      service: 'SmartHotel Backend API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    };
  }

  @Get('api/health')
  @Public()
  getApiHealth() {
    return this.getHealth();
  }
}
