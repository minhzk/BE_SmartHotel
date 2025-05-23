import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room } from './schemas/room.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name)
    private roomModel: Model<Room>,
    @InjectModel(Hotel.name)
    private hotelModel: Model<Hotel>,
  ) {}

  async create(createRoomDto: CreateRoomDto) {
    const room = await this.roomModel.create(createRoomDto);

    // Kiểm tra và cập nhật min_price, max_price của hotel nếu cần
    if (room.hotel_id && room.price_per_night != null) {
      const hotel = await this.hotelModel.findById(room.hotel_id);
      if (hotel) {
        let update: any = {};
        if (hotel.min_price == null || room.price_per_night < hotel.min_price) {
          update.min_price = room.price_per_night;
        }
        if (hotel.max_price == null || room.price_per_night > hotel.max_price) {
          update.max_price = room.price_per_night;
        }
        if (Object.keys(update).length > 0) {
          await this.hotelModel.updateOne({ _id: hotel._id }, { $set: update });
        }
      }
    }

    return room;
  }

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = (await this.roomModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.roomModel
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
      throw new BadRequestException('Invalid room ID');
    }

    const room = await this.roomModel.findById(id);
    if (!room) {
      throw new BadRequestException(`Room with ID ${id} not found`);
    }

    return room;
  }

  async findByHotel(
    hotelId: string,
    query: string,
    current: number,
    pageSize: number,
  ) {
    if (!mongoose.isValidObjectId(hotelId)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    const { filter, sort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Add hotel_id filter
    filter.hotel_id = hotelId;

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = (await this.roomModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.roomModel
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

  async update(id: string, updateRoomDto: UpdateRoomDto) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid room ID');
    }

    const room = await this.roomModel.findByIdAndUpdate(id, updateRoomDto, {
      new: true,
    });
    if (!room) {
      throw new BadRequestException(`Room with ID ${id} not found`);
    }

    // Kiểm tra và cập nhật min_price, max_price của hotel nếu cần
    if (room.hotel_id && room.price_per_night != null) {
      // Lấy tất cả các phòng của khách sạn để xác định lại min/max
      const rooms = await this.roomModel.find({ hotel_id: room.hotel_id });
      const prices = rooms
        .map((r) => r.price_per_night)
        .filter((p) => p != null);
      if (prices.length > 0) {
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);
        await this.hotelModel.updateOne(
          { _id: room.hotel_id },
          { $set: { min_price, max_price } },
        );
      }
    }

    return room;
  }

  async remove(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid room ID');
    }

    const room = await this.roomModel.findByIdAndDelete(id);
    if (!room) {
      throw new BadRequestException(`Room with ID ${id} not found`);
    }

    return { deleted: true };
  }
}
