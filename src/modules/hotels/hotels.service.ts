import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Hotel } from './schemas/hotel.schema';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import aqp from 'api-query-params';
import mongoose from 'mongoose';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ConfigService } from '@nestjs/config';
import { Room } from '../rooms/schemas/room.schema';
import {
  RoomAvailability,
  RoomStatus,
} from '../room-availability/schemas/room-availability.schema';

function removeVietnameseTones(str: string) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, '');
}

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name)
    private hotelModel: Model<Hotel>,
    @InjectModel(Room.name)
    private roomModel: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private roomAvailabilityModel: Model<RoomAvailability>,
    private readonly configService: ConfigService,
  ) {}

  async create(createHotelDto: CreateHotelDto) {
    const hotel = await this.hotelModel.create(createHotelDto);
    return hotel;
  }

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort: aqpSort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Handle combined search for both name and city (không dấu)
    if (filter.search) {
      console.log('Search query:', filter.search);
      // Loại bỏ dấu tiếng Việt khỏi filter.search và thay thế mọi ký tự không phải chữ/số/thường bằng khoảng trắng
      const searchNoDiacritics = removeVietnameseTones(
        filter.search,
      ).toLowerCase();

      console.log('Search query without diacritics:', searchNoDiacritics);

      filter.$or = [
        { name: { $regex: searchNoDiacritics, $options: 'i' } },
        { name: { $regex: filter.search, $options: 'i' } },
        { city: { $regex: searchNoDiacritics, $options: 'i' } },
        { city: { $regex: filter.search, $options: 'i' } },
      ];

      console.log('Filter after search:', JSON.stringify(filter, null, 2));

      delete filter.search;
    }

    // Handle search by name
    if (filter.name) {
      const nameNoDiacritics = removeVietnameseTones(filter.name).toLowerCase();
      // Tìm kiếm theo cả tên có dấu và không dấu
      filter.$or = [
        { name: { $regex: filter.name, $options: 'i' } },
        { name: { $regex: nameNoDiacritics, $options: 'i' } },
      ];
      delete filter.name;
    }

    // Handle search by city
    if (filter.city) {
      // Bỏ qua logic mapping phức tạp, chỉ tìm kiếm không phân biệt HOA/thường
      filter.city = { $regex: filter.city, $options: 'i' };
    }

    // Handle is_active filter
    if (filter.is_active !== undefined) {
      if (filter.is_active === 'true' || filter.is_active === true)
        filter.is_active = true;
      else if (filter.is_active === 'false' || filter.is_active === false)
        filter.is_active = false;
    }

    // Handle ratings filter
    if (filter.rating) {
      // Nếu rating là 5 thì chỉ lấy đúng rating = 5
      // Nếu rating là 4 thì lấy từ 4 đến dưới 5 (4 <= rating < 5)
      // Nếu rating là 3 thì lấy từ 3 đến dưới 4, v.v.
      const rating = Number(filter.rating);
      if (!isNaN(rating) && rating >= 1 && rating <= 5) {
        if (rating === 5) {
          filter.rating = 5;
        } else {
          filter.rating = { $gte: rating, $lt: rating + 1 };
        }
      } else {
        delete filter.rating;
      }
    }

    // Handle price range filter
    if (filter.min_price) {
      const minPrice = Number(filter.min_price);
      if (!isNaN(minPrice)) {
        filter.min_price = { $gte: minPrice };
      } else {
        delete filter.min_price;
      }
    }

    if (filter.max_price) {
      const maxPrice = Number(filter.max_price);
      if (!isNaN(maxPrice)) {
        filter.min_price = { ...filter.min_price, $lte: maxPrice };
        delete filter.max_price;
      } else {
        delete filter.max_price;
      }
    }

    // Handle capacity filtering
    if (filter.capacity) {
      const capacity = Number(filter.capacity);
      if (!isNaN(capacity) && capacity > 0) {
        filter.max_capacity = { $gte: capacity };
      }
      delete filter.capacity;
    }

    // Handle adults and children count
    const adultsCount = filter.adults ? Number(filter.adults) : 0;
    const childrenCount = filter.children ? Number(filter.children) : 0;

    // Xóa các trường này khỏi filter vì chúng ta sẽ xử lý riêng
    delete filter.adults;
    delete filter.children;

    // Handle check-in and check-out dates
    const checkIn = filter.check_in ? new Date(filter.check_in) : null;
    const checkOut = filter.check_out ? new Date(filter.check_out) : null;

    delete filter.check_in;
    delete filter.check_out;

    // Biến để kiểm soát liệu có cần áp dụng bộ lọc hotel_id hay không
    let hasSpecialFilters = false;
    let compatibleHotelIds: string[] = [];

    // Trường hợp 1: Có yêu cầu tìm theo số người (adults/children)
    if (adultsCount > 0 || childrenCount > 0) {
      hasSpecialFilters = true;
      const roomQueryForPeople: any = {
        is_active: true,
        is_bookable: true,
      };

      if (adultsCount > 0) {
        roomQueryForPeople.max_adults = { $gte: adultsCount };
      }

      if (childrenCount > 0) {
        roomQueryForPeople.max_children = { $gte: childrenCount };
      }

      const compatibleRooms = await this.roomModel.find(roomQueryForPeople);

      // Lấy danh sách khách sạn có phòng phù hợp với số người
      const peopleFilteredHotelIds = [
        ...new Set(compatibleRooms.map((room) => room.hotel_id.toString())),
      ];

      compatibleHotelIds = peopleFilteredHotelIds;
    }

    // Trường hợp 2: Có yêu cầu tìm theo ngày check-in/check-out
    if (checkIn && checkOut && checkIn < checkOut) {
      hasSpecialFilters = true;
      const unavailableRoomIds = await this.findUnavailableRooms(
        checkIn,
        checkOut,
      );

      // Tìm các phòng còn trống trong khoảng thời gian này
      const roomQueryForDates: any = {
        is_active: true,
        is_bookable: true,
      };

      // Nếu có phòng không khả dụng, loại trừ chúng khỏi kết quả
      if (unavailableRoomIds.length > 0) {
        roomQueryForDates._id = { $nin: unavailableRoomIds };
      }

      const availableRooms = await this.roomModel.find(roomQueryForDates);

      // Lấy danh sách khách sạn có phòng trống
      const dateFilteredHotelIds = [
        ...new Set(availableRooms.map((room) => room.hotel_id.toString())),
      ];

      if (compatibleHotelIds.length > 0) {
        // Nếu đã có lọc theo số người, lấy giao của hai danh sách
        // (khách sạn vừa có phòng trống, vừa đáp ứng số người)
        compatibleHotelIds = compatibleHotelIds.filter((id) =>
          dateFilteredHotelIds.includes(id),
        );
      } else {
        // Nếu chưa có lọc nào khác, sử dụng kết quả lọc theo ngày
        compatibleHotelIds = dateFilteredHotelIds;
      }
    }

    // Áp dụng bộ lọc khách sạn nếu có yêu cầu đặc biệt
    if (hasSpecialFilters) {
      if (compatibleHotelIds.length > 0) {
        // Chỉ lấy các khách sạn thỏa mãn điều kiện
        filter._id = { $in: compatibleHotelIds };
      } else {
        // Trả về kết quả rỗng nếu không có khách sạn nào thỏa mãn
        return {
          meta: {
            current: current || 1,
            pageSize: pageSize || 10,
            pages: 0,
            total: 0,
          },
          results: [],
        };
      }
    }

    // Handle sortBy param from query string
    let sort = aqpSort || {};
    if (filter.sortBy) {
      const lastUnderscore = filter.sortBy.lastIndexOf('_');
      let field = filter.sortBy;
      let order = 'desc';
      if (lastUnderscore > 0) {
        field = filter.sortBy.substring(0, lastUnderscore);
        order = filter.sortBy.substring(lastUnderscore + 1);
      }
      if (field) {
        sort = {};
        sort[field] = order === 'asc' ? 1 : -1;
      }
      delete filter.sortBy;
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

  private async findUnavailableRooms(
    checkIn: Date,
    checkOut: Date,
  ): Promise<string[]> {
    const unavailableRoomAvailabilities = await this.roomAvailabilityModel.find(
      {
        $and: [
          { start_date: { $lte: checkOut } },
          { end_date: { $gte: checkIn } },
          { status: { $ne: RoomStatus.AVAILABLE } },
        ],
      },
    );

    return unavailableRoomAvailabilities.map((ra) => ra.room_id);
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

    console.log('Received images:', updateHotelDto.images);

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

  async updateHotelImages(
    hotelId: string,
    images: Array<{ url: string; cloudinary_id: string; description: string }>,
  ) {
    if (!mongoose.isValidObjectId(hotelId)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    // Cập nhật images trong hotel document
    const hotel = await this.hotelModel.findByIdAndUpdate(
      hotelId,
      { images: images },
      { new: true },
    );

    if (!hotel) {
      throw new BadRequestException(`Hotel with ID ${hotelId} not found`);
    }

    return hotel;
  }

  // Khi xóa ảnh cũ khi cập nhật hotel
  async removeUnusedImages(
    oldImages: Array<{ cloudinary_id: string }>,
    newImages: Array<{ cloudinary_id: string }>,
  ) {
    const cloudinaryService = new CloudinaryService(this.configService);

    // Tìm các ảnh có trong oldImages nhưng không có trong newImages
    const imagesToDelete = oldImages.filter(
      (oldImg) =>
        !newImages.some(
          (newImg) => newImg.cloudinary_id === oldImg.cloudinary_id,
        ),
    );

    // Xóa các ảnh không sử dụng từ Cloudinary
    for (const image of imagesToDelete) {
      if (image.cloudinary_id) {
        try {
          await cloudinaryService.deleteImage(image.cloudinary_id);
        } catch (error) {
          console.error(
            `Failed to delete image from Cloudinary: ${error.message}`,
          );
        }
      }
    }
  }

  async countHotelsByCity() {
    // Đếm số lượng khách sạn theo từng city
    const result = await this.hotelModel.aggregate([
      {
        $group: {
          _id: '$city',
          count: { $sum: 1 },
        },
      },
    ]);
    // Chuyển về object { city: count }
    const cityCounts: Record<string, number> = {};
    result.forEach((item) => {
      cityCounts[item._id] = item.count;
    });
    return cityCounts;
  }
}
