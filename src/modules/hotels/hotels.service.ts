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

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = (await this.hotelModel.find(filter)).length;
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
