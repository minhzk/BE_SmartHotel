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
import { HotelsService } from './hotels.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @ResponseMessage('Create hotel successfully')
  create(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelsService.create(createHotelDto);
  }

  @Get('search')
  @Public()
  @ResponseMessage('Search hotels successfully')
  async searchHotels(
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
    @Query('name') name: string,
    @Query('city') city: string,
    @Query('rating') rating: string,
    @Query('min_price') minPrice: string,
    @Query('max_price') maxPrice: string,
    @Query('capacity') capacity: string,
  ) {
    return this.hotelsService.findAll(query, +current, +pageSize);
  }

  @Get()
  @Public()
  @ResponseMessage('Fetch hotels successfully')
  async findAll(
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    console.log('========== HOTELS CONTROLLER ==========');
    console.log('Controller received request with query:', query);
    return this.hotelsService.findAll(query, +current, +pageSize);
  }

  @Get(':id')
  @Public()
  @ResponseMessage('Fetch hotel successfully')
  findOne(@Param('id') id: string) {
    return this.hotelsService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('Update hotel successfully')
  update(@Param('id') id: string, @Body() updateHotelDto: UpdateHotelDto) {
    return this.hotelsService.update(id, updateHotelDto);
  }

  @Delete(':id')
  @ResponseMessage('Delete hotel successfully')
  remove(@Param('id') id: string) {
    return this.hotelsService.remove(id);
  }
}
