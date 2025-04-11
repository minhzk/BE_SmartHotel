import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RoomAvailability,
  RoomStatus,
} from './schemas/room-availability.schema';
import { CreateRoomAvailabilityDto } from './dto/create-room-availability.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

// Cấu hình dayjs để sử dụng plugin UTC
dayjs.extend(utc);

@Injectable()
export class RoomAvailabilityService {
  constructor(
    @InjectModel(RoomAvailability.name)
    private roomAvailabilityModel: Model<RoomAvailability>,
  ) {}

  async create(createRoomAvailabilityDto: CreateRoomAvailabilityDto) {
    try {
      const availability = await this.roomAvailabilityModel.create(
        createRoomAvailabilityDto,
      );
      return availability;
    } catch (error) {
      if (error.code === 11000) {
        throw new BadRequestException(
          'Availability record already exists for this room and date',
        );
      }
      throw error;
    }
  }

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    const totalItems = (await this.roomAvailabilityModel.find(filter)).length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.roomAvailabilityModel
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
      throw new BadRequestException('Invalid availability ID');
    }

    const availability = await this.roomAvailabilityModel.findById(id);
    if (!availability) {
      throw new BadRequestException(`Availability with ID ${id} not found`);
    }

    return availability;
  }

  async findByRoomAndDateRange(roomId: string, startDate: Date, endDate: Date) {
    if (!mongoose.isValidObjectId(roomId)) {
      throw new BadRequestException('Invalid room ID');
    }

    return this.roomAvailabilityModel.find({
      room_id: roomId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    });
  }

  async update(
    id: string,
    updateRoomAvailabilityDto: UpdateRoomAvailabilityDto,
  ) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid availability ID');
    }

    const availability = await this.roomAvailabilityModel.findByIdAndUpdate(
      id,
      updateRoomAvailabilityDto,
      { new: true },
    );
    if (!availability) {
      throw new BadRequestException(`Availability with ID ${id} not found`);
    }

    return availability;
  }

  async remove(id: string) {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid availability ID');
    }

    const availability = await this.roomAvailabilityModel.findByIdAndDelete(id);
    if (!availability) {
      throw new BadRequestException(`Availability with ID ${id} not found`);
    }

    return { deleted: true };
  }

  async generateAvailabilityForRoom(
    roomId: string,
    startDate: Date,
    endDate: Date,
    status: RoomStatus = RoomStatus.AVAILABLE,
    priceOverride: number | null = null,
  ) {
    if (!mongoose.isValidObjectId(roomId)) {
      throw new BadRequestException('Invalid room ID');
    }

    // Đảm bảo sử dụng UTC để xử lý ngày tháng
    const start = dayjs.utc(startDate).startOf('day');
    const end = dayjs.utc(endDate).startOf('day');
    const daysCount = end.diff(start, 'day') + 1;

    if (daysCount <= 0) {
      throw new BadRequestException('End date must be after start date');
    }

    const createdRecords = [];
    let currentDate = start;

    for (let i = 0; i < daysCount; i++) {
      try {
        const record = await this.roomAvailabilityModel.create({
          room_id: roomId,
          // Tạo date là UTC với giờ là 00:00:00
          date: currentDate.toDate(),
          status,
          price_override: priceOverride,
        });
        createdRecords.push(record);
      } catch (error) {
        if (error.code !== 11000) {
          // Ignore duplicate key errors
          throw error;
        }
      }
      currentDate = currentDate.add(1, 'day');
    }

    return {
      message: `Generated ${createdRecords.length} availability records for room`,
      records: createdRecords,
    };
  }

  async bulkUpdateStatus(
    roomId: string,
    startDate: Date,
    endDate: Date,
    status: RoomStatus,
  ) {
    if (!mongoose.isValidObjectId(roomId)) {
      throw new BadRequestException('Invalid room ID');
    }

    // Đảm bảo sử dụng UTC để xử lý ngày tháng
    const start = dayjs.utc(startDate).startOf('day').toDate();
    const end = dayjs.utc(endDate).startOf('day').toDate();

    const result = await this.roomAvailabilityModel.updateMany(
      {
        room_id: roomId,
        date: {
          $gte: start,
          $lte: end,
        },
      },
      { $set: { status } },
    );

    return {
      message: `Updated ${result.modifiedCount} availability records for room`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  async checkRoomAvailability(roomId: string, date: Date): Promise<boolean> {
    const startOfDay = dayjs.utc(date).startOf('day').toDate();
    const endOfDay = dayjs.utc(date).endOf('day').toDate();

    const availability = await this.roomAvailabilityModel.findOne({
      room_id: roomId,
      date: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    // Nếu không tìm thấy bản ghi, coi như phòng có sẵn
    if (!availability) {
      return true; // Phòng được coi là khả dụng khi không có bản ghi
    }

    // Nếu có bản ghi, kiểm tra trạng thái
    return availability.status === RoomStatus.AVAILABLE;
  }
}
