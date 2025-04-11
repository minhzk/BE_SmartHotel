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
      startDate: Date;
      endDate: Date;
      status?: RoomStatus;
      priceOverride?: number | null;
    },
  ) {
    return this.roomAvailabilityService.generateAvailabilityForRoom(
      body.roomId,
      body.startDate,
      body.endDate,
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
      startDate: Date;
      endDate: Date;
      status: RoomStatus;
    },
  ) {
    return this.roomAvailabilityService.bulkUpdateStatus(
      body.roomId,
      body.startDate,
      body.endDate,
      body.status,
    );
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
    @Query('startDate') startDate: Date,
    @Query('endDate') endDate: Date,
  ) {
    return this.roomAvailabilityService.findByRoomAndDateRange(
      roomId,
      startDate,
      endDate,
    );
  }

  @Get('check')
  @Public()
  @ResponseMessage('Check room availability successfully')
  async checkAvailability(
    @Query('roomId') roomId: string,
    @Query('date') dateStr: string,
  ) {
    const date = new Date(dateStr);
    const isAvailable =
      await this.roomAvailabilityService.checkRoomAvailability(roomId, date);

    return {
      roomId,
      date,
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
