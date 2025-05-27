import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { RoomAvailabilityService } from './room-availability.service';
import { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import { Public, ResponseMessage } from '@/decorator/customize';
import { RoomStatus } from './schemas/room-availability.schema';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

// Cấu hình dayjs để sử dụng plugin UTC
dayjs.extend(utc);

@Controller('room-availability')
export class RoomAvailabilityController {
  constructor(
    private readonly roomAvailabilityService: RoomAvailabilityService,
  ) {}

  @Post()
  @ResponseMessage('Create room availability successfully')
  create(@Body() createRoomAvailabilityDto: CreateRoomAvailabilityDto) {
    return this.roomAvailabilityService.create(createRoomAvailabilityDto);
  }

  @Post('generate')
  @ResponseMessage('Generate room availability successfully')
  generateAvailability(
    @Body()
    body: {
      roomId: string;
      startDate: string | Date;
      endDate: string | Date;
      status?: RoomStatus;
      priceOverride?: number | null;
    },
  ) {
    // Xử lý ngày tháng bằng dayjs để đảm bảo tính nhất quán
    const startDate = dayjs.utc(body.startDate).startOf('day').toDate();
    const endDate = dayjs.utc(body.endDate).startOf('day').toDate();

    return this.roomAvailabilityService.generateAvailabilityForRoom(
      body.roomId,
      startDate,
      endDate,
      body.status,
      body.priceOverride,
    );
  }

  @Post('bulk-update-status')
  @ResponseMessage('Bulk update room availability status successfully')
  bulkUpdateStatus(
    @Body()
    body: {
      roomId: string;
      startDate: string | Date;
      endDate: string | Date;
      status: RoomStatus;
    },
  ) {
    const startDate = dayjs.utc(body.startDate).startOf('day').toDate();
    const endDate = dayjs.utc(body.endDate).startOf('day').toDate();

    return this.roomAvailabilityService.bulkUpdateStatus(
      body.roomId,
      startDate,
      endDate,
      body.status,
    );
  }

  @Post('auto-cancel-expired')
  @ResponseMessage('Auto cancel expired reservations successfully')
  autoCancelExpiredReservations() {
    return this.roomAvailabilityService.autoCancelExpiredReservations();
  }

  @Get()
  @Public()
  @ResponseMessage('Fetch room availabilities successfully')
  findAll(
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.roomAvailabilityService.findAll(query, +current, +pageSize);
  }

  @Get('room/:roomId/date-range')
  @Public()
  @ResponseMessage('Fetch room availability for date range successfully')
  findByRoomAndDateRange(
    @Param('roomId') roomId: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ) {
    const startDate = dayjs.utc(startDateStr).startOf('day').toDate();
    const endDate = dayjs.utc(endDateStr).startOf('day').toDate();

    return this.roomAvailabilityService.findByRoomAndDateRange(
      roomId,
      startDate,
      endDate,
    );
  }

  @Get('check-room-dates')
  @Public()
  @ResponseMessage('Check room availability for date range')
  async checkRoomAvailabilityForDates(
    @Query('roomId') roomId: string,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
  ) {
    const startDate = dayjs.utc(startDateStr).startOf('day').toDate();
    const endDate = dayjs.utc(endDateStr).startOf('day').toDate();

    const isAvailable =
      await this.roomAvailabilityService.checkRoomAvailabilityForDateRange(
        roomId,
        startDate,
        endDate,
      );

    return {
      roomId,
      startDate,
      endDate,
      isAvailable,
    };
  }

  @Get(':id')
  @Public()
  @ResponseMessage('Fetch room availability successfully')
  findOne(@Param('id') id: string) {
    return this.roomAvailabilityService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Update room availability successfully')
  update(
    @Param('id') id: string,
    @Body() updateRoomAvailabilityDto: UpdateRoomAvailabilityDto,
  ) {
    return this.roomAvailabilityService.update(id, updateRoomAvailabilityDto);
  }

  @Delete(':id')
  @ResponseMessage('Delete room availability successfully')
  remove(@Param('id') id: string) {
    return this.roomAvailabilityService.remove(id);
  }
}
