import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Request,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { JwtAuthGuard } from '@/auth/passport/jwt-auth.guard';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ResponseMessage('Create booking successfully')
  create(@Request() req, @Body() createBookingDto: CreateBookingDto) {
    return this.bookingsService.create(req.user._id, createBookingDto);
  }

  @Get()
  @ResponseMessage('Fetch bookings successfully')
  findAll(
    @Request() req,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.bookingsService.findAll(
      req.user._id,
      query,
      +current,
      +pageSize,
    );
  }

  @Get(':id')
  @ResponseMessage('Fetch booking successfully')
  findOne(@Request() req, @Param('id') id: string) {
    return this.bookingsService.findOne(id, req.user._id);
  }

  @Patch()
  @ResponseMessage('Update booking successfully')
  update(@Request() req, @Body() updateBookingDto: UpdateBookingDto) {
    return this.bookingsService.update(req.user._id, updateBookingDto);
  }

  @Post('cancel')
  @ResponseMessage('Cancel booking successfully')
  cancel(@Request() req, @Body() cancelBookingDto: CancelBookingDto) {
    return this.bookingsService.cancel(req.user._id, cancelBookingDto);
  }

  @Post(':id/pay-deposit')
  @ResponseMessage('Pay deposit successfully')
  payDeposit(
    @Request() req,
    @Param('id') id: string,
    @Body('payment_method') paymentMethod: string,
  ) {
    return this.bookingsService.payDeposit(id, req.user._id, paymentMethod);
  }

  @Post(':id/pay-remaining')
  @ResponseMessage('Pay remaining amount successfully')
  payRemainingAmount(
    @Request() req,
    @Param('id') id: string,
    @Body('payment_method') paymentMethod: string,
  ) {
    return this.bookingsService.payRemainingAmount(
      id,
      req.user._id,
      paymentMethod,
    );
  }
}
