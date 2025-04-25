import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Hotel } from './schemas/hotel.schema';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name)
    private hotelModel: Model<Hotel>,
  ) {}

  async create(createHotelDto: CreateHotelDto) {
    const hotel = await this.hotelModel.create(createHotelDto);
    return hotel;
  }

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Handle search by name
    if (filter.name) {
      filter.name = { $regex: filter.name, $options: 'i' }; // Case-insensitive search
    }

    // Handle search by city
    if (filter.city) {
      filter.city = { $regex: filter.city, $options: 'i' }; // Case-insensitive search
    }

    // Handle ratings filter - sửa lại cách lọc rating
    if (filter.rating) {
      const rating = Number(filter.rating);
      if (!isNaN(rating) && rating >= 1 && rating <= 5) {
        // Lọc khách sạn theo số sao chính xác
        filter.rating = Math.floor(rating); // Đảm bảo rating là số nguyên (1, 2, 3, 4, 5)
      } else {
        // Nếu giá trị rating không hợp lệ, xóa khỏi filter
        delete filter.rating;
      }
    }

    // Xử lý tìm kiếm theo khoảng giá

    // Khi người dùng tìm với min_price, họ muốn tìm khách sạn có giá tối thiểu >= giá họ nhập
    if (filter.min_price) {
      const minPrice = Number(filter.min_price);
      if (!isNaN(minPrice)) {
        // Tìm khách sạn có min_price lớn hơn hoặc bằng giá người dùng nhập
        filter.min_price = { $gte: minPrice };
      } else {
        delete filter.min_price;
      }
    }

    // Khi người dùng tìm với max_price, họ muốn tìm khách sạn có giá tối đa <= giá họ nhập
    if (filter.max_price) {
      const maxPrice = Number(filter.max_price);
      if (!isNaN(maxPrice)) {
        // Tìm khách sạn có max_price nhỏ hơn hoặc bằng giá người dùng nhập
        filter.max_price = { $lte: maxPrice };
      } else {
        delete filter.max_price;
      }
    }

    // Handle capacity filtering
    if (filter.capacity) {
      filter.max_capacity = { $gte: Number(filter.capacity) };
      delete filter.capacity;
    }

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = await this.hotelModel.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.hotelModel
      .find(filter)
      .limit(pageSize)
      .skip(skip)
      .sort(sort as any);

    return {
      meta: {
        current: current,
        pageSize: pageSize,
        pages: totalPages,
        total: totalItems,
      },
      results,
    };
  }

  async findOne(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    const hotel = await this.hotelModel.findById(id);
    if (!hotel) {
      throw new BadRequestException(`Hotel with ID ${id} not found`);
    }

    return hotel;
  }

  async update(id: string, updateHotelDto: UpdateHotelDto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    const hotel = await this.hotelModel.findByIdAndUpdate(id, updateHotelDto, {
      new: true,
    });
    if (!hotel) {
      throw new BadRequestException(`Hotel with ID ${id} not found`);
    }

    return hotel;
  }

  async remove(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    const hotel = await this.hotelModel.findByIdAndDelete(id);
    if (!hotel) {
      throw new BadRequestException(`Hotel with ID ${id} not found`);
    }

    return { deleted: true };
  }
}
