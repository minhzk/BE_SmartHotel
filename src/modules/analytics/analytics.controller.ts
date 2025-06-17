import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ResponseMessage } from '@/decorator/customize';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ResponseMessage('Get overview statistics successfully')
  getOverviewStats() {
    return this.analyticsService.getOverviewStats();
  }

  @Get('revenue')
  @ResponseMessage('Get revenue statistics successfully')
  getRevenueStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('period') period: string = 'day',
  ) {
    return this.analyticsService.getRevenueStats({
      startDate,
      endDate,
      period,
    });
  }

  @Get('bookings')
  @ResponseMessage('Get booking statistics successfully')
  getBookingStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('period') period: string = 'day',
  ) {
    return this.analyticsService.getBookingStats({
      startDate,
      endDate,
      period,
    });
  }

  @Get('hotels-by-city')
  @ResponseMessage('Get hotels by city successfully')
  getHotelsByCity() {
    return this.analyticsService.getHotelsByCity();
  }

  @Get('top-hotels')
  @ResponseMessage('Get top hotels successfully')
  getTopHotels(@Query('limit') limit: string = '10') {
    return this.analyticsService.getTopHotels({ limit: parseInt(limit) });
  }

  @Get('users')
  @ResponseMessage('Get user statistics successfully')
  getUserStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('period') period: string = 'day',
  ) {
    return this.analyticsService.getUserStats({ startDate, endDate, period });
  }
}
