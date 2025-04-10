import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Room } from './schemas/room.schema';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name)
    private roomModel: Model<Room>,
  ) {}

  async create(createRoomDto: CreateRoomDto) {
    const room = await this.roomModel.create(createRoomDto);
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
