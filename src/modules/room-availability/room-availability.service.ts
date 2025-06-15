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
import isBetween from 'dayjs/plugin/isBetween';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import { Room } from '../rooms/schemas/room.schema';

// Cấu hình dayjs để sử dụng plugin
dayjs.extend(utc);
dayjs.extend(isBetween);
dayjs.extend(isSameOrAfter);

@Injectable()
export class RoomAvailabilityService {
  constructor(
    @InjectModel(RoomAvailability.name)
    private roomAvailabilityModel: Model<RoomAvailability>,
    @InjectModel(Room.name)
    private roomModel: Model<Room>, // Thêm inject Room model
  ) {}

  async create(createRoomAvailabilityDto: CreateRoomAvailabilityDto) {
    try {
      // Kiểm tra ngày kết thúc phải sau ngày bắt đầu
      if (
        dayjs(createRoomAvailabilityDto.end_date).isBefore(
          dayjs(createRoomAvailabilityDto.start_date),
        )
      ) {
        throw new BadRequestException('End date must be after start date');
      }

      // Kiểm tra xem đã có khoảng thời gian nào chồng chéo không
      const conflictingRecord = await this.checkForOverlap(
        createRoomAvailabilityDto.room_id,
        createRoomAvailabilityDto.start_date,
        createRoomAvailabilityDto.end_date,
      );

      if (conflictingRecord) {
        throw new BadRequestException(
          'There is an overlapping availability record for this room',
        );
      }

      const availability = await this.roomAvailabilityModel.create(
        createRoomAvailabilityDto,
      );
      return availability;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to create room availability: ${error.message}`,
      );
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
      $or: [
        // Trường hợp 1: khoảng thời gian đã đặt bao trùm khoảng thời gian muốn tìm
        {
          start_date: { $lte: startDate },
          end_date: { $gte: endDate },
        },
        // Trường hợp 2: ngày bắt đầu nằm trong khoảng thời gian đã đặt
        {
          start_date: { $lte: startDate },
          end_date: { $gt: startDate },
        },
        // Trường hợp 3: ngày kết thúc nằm trong khoảng thời gian đã đặt
        {
          start_date: { $lt: endDate },
          end_date: { $gte: endDate },
        },
        // Trường hợp 4: khoảng thời gian muốn tìm bao trùm khoảng thời gian đã đặt
        {
          start_date: { $gte: startDate },
          end_date: { $lte: endDate },
        },
      ],
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

    if (end.isBefore(start)) {
      throw new BadRequestException('End date must be after start date');
    }

    // Xóa các bản ghi cũ trong khoảng thời gian này (nếu có)
    await this.roomAvailabilityModel.deleteMany({
      room_id: roomId,
      $or: [
        // Các trường hợp chồng chéo
        {
          start_date: { $lte: start.toDate() },
          end_date: { $gte: start.toDate() },
        },
        {
          start_date: { $lte: end.toDate() },
          end_date: { $gte: end.toDate() },
        },
        {
          start_date: { $gte: start.toDate() },
          end_date: { $lte: end.toDate() },
        },
      ],
    });

    // Tạo bản ghi mới
    const newRecord = await this.roomAvailabilityModel.create({
      room_id: roomId,
      start_date: start.toDate(),
      end_date: end.toDate(),
      status,
      price_override: priceOverride,
    });

    return {
      message: `Generated availability record for room`,
      record: newRecord,
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

    // Kiểm tra xem có bản ghi nào trong khoảng thời gian này không
    const existingRecords = await this.findByRoomAndDateRange(
      roomId,
      start,
      end,
    );

    if (existingRecords && existingRecords.length > 0) {
      // Nếu có bản ghi, cập nhật trạng thái
      for (const record of existingRecords) {
        // Chỉ cập nhật những bản ghi có trạng thái khác với trạng thái cần cập nhật
        if (record.status !== status) {
          await this.roomAvailabilityModel.findByIdAndUpdate(record._id, {
            status,
          });
        }
      }

      return {
        message: `Updated ${existingRecords.length} availability records for room`,
        modifiedCount: existingRecords.length,
      };
    } else {
      // Nếu không có bản ghi, tạo mới
      await this.generateAvailabilityForRoom(roomId, start, end, status);

      return {
        message: `Created a new availability record for room`,
        modifiedCount: 1,
      };
    }
  }

  async checkRoomAvailabilityForDateRange(
    roomId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<boolean> {
    if (!mongoose.isValidObjectId(roomId)) {
      throw new BadRequestException('Invalid room ID');
    }

    // Convert to dayjs for easier manipulation
    const start = dayjs.utc(startDate).startOf('day').toDate();
    const end = dayjs.utc(endDate).startOf('day').toDate();

    // Kiểm tra xem có bản ghi nào với trạng thái BOOKED, RESERVED hoặc MAINTENANCE trong khoảng thời gian này không
    const unavailableRecords = await this.roomAvailabilityModel.find({
      room_id: roomId,
      status: {
        $in: [RoomStatus.BOOKED, RoomStatus.RESERVED, RoomStatus.MAINTENANCE],
      },
      $or: [
        // Các trường hợp chồng chéo
        {
          start_date: { $lte: start },
          end_date: { $gte: start },
        },
        {
          start_date: { $lte: end },
          end_date: { $gte: end },
        },
        {
          start_date: { $gte: start },
          end_date: { $lte: end },
        },
      ],
    });

    // Nếu có bản ghi không khả dụng, phòng không thể đặt
    return unavailableRecords.length === 0;
  }

  // Hàm kiểm tra xem có khoảng thời gian nào chồng chéo không
  private async checkForOverlap(
    roomId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return await this.roomAvailabilityModel.findOne({
      room_id: roomId,
      $or: [
        // Các trường hợp chồng chéo
        {
          start_date: { $lte: startDate },
          end_date: { $gte: startDate },
        },
        {
          start_date: { $lte: endDate },
          end_date: { $gte: endDate },
        },
        {
          start_date: { $gte: startDate },
          end_date: { $lte: endDate },
        },
      ],
    });
  }

  async updateRoomStatusAfterPayment(
    roomId: string,
    startDate: Date,
    endDate: Date,
    newStatus: RoomStatus,
  ) {
    // Tìm và cập nhật tất cả các bản ghi RESERVED thành BOOKED sau khi thanh toán
    const updatedRecords = await this.roomAvailabilityModel.updateMany(
      {
        room_id: roomId,
        status: RoomStatus.RESERVED,
        $or: [
          {
            start_date: { $lte: startDate },
            end_date: { $gte: startDate },
          },
          {
            start_date: { $lte: endDate },
            end_date: { $gte: endDate },
          },
          {
            start_date: { $gte: startDate },
            end_date: { $lte: endDate },
          },
        ],
      },
      { status: newStatus },
    );

    return {
      message: `Updated ${updatedRecords.modifiedCount} room availability records`,
      modifiedCount: updatedRecords.modifiedCount,
    };
  }

  /**
   * Lấy giá từng ngày trong khoảng, ưu tiên price_override nếu có, không thì lấy giá mặc định
   * @param roomId
   * @param startDate dayjs object
   * @param endDate dayjs object
   * @param defaultPrice (optional) giá mặc định nếu không có price_override
   */
  async getPricesByDate(
    roomId: string,
    startDate: dayjs.Dayjs,
    endDate: dayjs.Dayjs,
    defaultPrice?: number,
  ): Promise<{ date: string; price: number }[]> {
    // Lấy tất cả các bản ghi availability của phòng trong khoảng ngày
    const records = await this.findByRoomAndDateRange(
      roomId,
      startDate.toDate(),
      endDate.toDate(),
    );

    // Nếu chưa có giá mặc định hoặc defaultPrice là null, lấy từ Room model
    let fallbackPrice = defaultPrice;
    if (fallbackPrice === undefined || fallbackPrice === null) {
      const room = await this.roomModel.findById(roomId);
      fallbackPrice = room?.price_per_night ?? 0;
    }

    const prices: { date: string; price: number }[] = [];
    let current = startDate.clone();
    while (current.isBefore(endDate, 'day')) {
      // Tìm bản ghi availability chứa ngày này
      const record = records.find(
        (r) =>
          dayjs(current).isSameOrAfter(dayjs(r.start_date), 'day') &&
          !dayjs(current).isAfter(dayjs(r.end_date), 'day'),
      );
      let price = fallbackPrice;
      if (record && record.price_override != null) {
        price = record.price_override;
      }
      prices.push({
        date: current.format('YYYY-MM-DD'),
        price,
      });
      current = current.add(1, 'day');
    }
    return prices;
  }
}
