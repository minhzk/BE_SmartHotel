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

  @Get()
  @Public()
  @ResponseMessage('Fetch hotels successfully')
  async findAll(@Query() query: any) {
    // Nếu có groupBy=city thì trả về số lượng khách sạn theo từng city
    if (query.groupBy === 'city') {
      const cityCounts = await this.hotelsService.countHotelsByCity();
      return { cityCounts };
    }
    const current = query.current ? +query.current : 1;
    const pageSize = query.pageSize ? +query.pageSize : 5;
    return this.hotelsService.findAll(query, current, pageSize);
  }

  @Get(':id')
  @Public()
  @ResponseMessage('Fetch hotel successfully')
  findOne(@Param('id') id: string) {
    return this.hotelsService.findOne(id);
  }

  @Patch()
  @ResponseMessage('Update hotel successfully')
  async update(@Body() updateHotelDto: UpdateHotelDto) {
    // Lấy images cũ trước khi cập nhật
    const existingHotel = await this.hotelsService.findOne(updateHotelDto._id);

    // Ensure images have cloudinary_id or use empty array
    const oldImages = (existingHotel.images || []).map((img) => ({
      cloudinary_id: img.cloudinary_id || '',
      url: img.url,
      description: img.description,
    }));

    // Cập nhật hotel với thông tin mới
    const updatedHotel = await this.hotelsService.update(
      updateHotelDto._id,
      updateHotelDto,
    );

    // Ensure images have cloudinary_id for comparison
    const newImages = (updateHotelDto.images || []).map((img) => ({
      cloudinary_id: img.cloudinary_id || '',
      url: img.url,
      description: img.description,
    }));

    // Xóa ảnh không sử dụng
    await this.hotelsService.removeUnusedImages(oldImages, newImages);

    return updatedHotel;
  }

  @Delete(':id')
  @ResponseMessage('Delete hotel successfully')
  remove(@Param('id') id: string) {
    return this.hotelsService.remove(id);
  }
}
