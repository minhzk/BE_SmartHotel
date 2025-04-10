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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ResponseMessage('Create room successfully')
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Get()
  @Public()
  @ResponseMessage('Fetch rooms successfully')
  async findAll(
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.roomsService.findAll(query, +current, +pageSize);
  }

  @Get('hotel/:hotelId')
  @Public()
  @ResponseMessage('Fetch rooms by hotel successfully')
  async findByHotel(
    @Param('hotelId') hotelId: string,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.roomsService.findByHotel(hotelId, query, +current, +pageSize);
  }

  @Get(':id')
  @Public()
  @ResponseMessage('Fetch room successfully')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Update room successfully')
  update(@Param('id') id: string, @Body() updateRoomDto: UpdateRoomDto) {
    return this.roomsService.update(id, updateRoomDto);
  }

  @Delete(':id')
  @ResponseMessage('Delete room successfully')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}
