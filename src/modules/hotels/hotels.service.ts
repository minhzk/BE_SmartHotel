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

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name)
    private hotelModel: Model<Hotel>,
    @InjectModel(Room.name)
    private roomModel: Model<Room>,
    private readonly configService: ConfigService,
  ) {}

  async create(createHotelDto: CreateHotelDto) {
    const hotel = await this.hotelModel.create(createHotelDto);
    return hotel;
  }

  async findAll(query: string, current: number, pageSize: number) {
    const { filter, sort } = aqp(query);
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;

    // Handle combined search for both name and city
    if (filter.search) {
      const searchRegex = { $regex: filter.search, $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { city: searchRegex }
      ];
      delete filter.search;
    }

    // Handle search by name
    if (filter.name) {
      filter.name = { $regex: filter.name, $options: 'i' }; // Case-insensitive search
    }

    // Handle search by city
    if (filter.city) {
      // Bỏ qua logic mapping phức tạp, chỉ tìm kiếm không phân biệt HOA/thường
      filter.city = { $regex: filter.city, $options: 'i' };
    }

    // Handle ratings filter
    if (filter.rating) {
      const rating = Number(filter.rating);
      if (!isNaN(rating) && rating >= 1 && rating <= 5) {
        filter.rating = { $gte: Math.floor(rating) };
      } else {
        delete filter.rating;
      }
    }

    // Xử lý tìm kiếm theo khoảng giá
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

    // Xử lý tìm kiếm theo số người lớn và trẻ em
    const adultsCount = filter.adults ? Number(filter.adults) : 0;
    const childrenCount = filter.children ? Number(filter.children) : 0;

    // Xóa các trường này khỏi filter vì chúng ta sẽ xử lý riêng
    delete filter.adults;
    delete filter.children;

    // Nếu có yêu cầu về số người lớn hoặc trẻ em
    if (adultsCount > 0 || childrenCount > 0) {
      // Tạo query để tìm các phòng thỏa mãn điều kiện
      const roomFilter: any = {};

      if (adultsCount > 0) {
        roomFilter.max_adults = { $gte: adultsCount };
      }

      if (childrenCount > 0) {
        roomFilter.max_children = { $gte: childrenCount };
      }

      // Tìm tất cả các phòng thỏa mãn điều kiện
      const suitableRooms = await this.roomModel
        .find(roomFilter)
        .distinct('hotel_id');

      // Chỉ lấy khách sạn có phòng phù hợp
      if (suitableRooms.length > 0) {
        filter._id = { $in: suitableRooms };
      } else {
        // Nếu không có phòng nào phù hợp, trả về kết quả rỗng
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

    console.log('Received images:', updateHotelDto.images); // Log để kiểm tra

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
}
