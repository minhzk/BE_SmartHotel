import { Injectable, Logger } from '@nestjs/common';
import { HotelsService } from '../hotels/hotels.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { ObjectId } from 'mongoose';

@Injectable()
export class ChatbotDataService {
  private readonly logger = new Logger(ChatbotDataService.name);

  // Ánh xạ tên thành phố có dấu -> không dấu
  private readonly cityMapping = {
    'hồ chí minh': 'ho chi minh',
    'hà nội': 'ha noi',
    'đà nẵng': 'da nang',
    'nha trang': 'nha trang',
    'phú quốc': 'phu quoc',
    'hội an': 'hoi an',
    huế: 'hue',
    'đà lạt': 'da lat',
    'vũng tàu': 'vung tau',
    'cần thơ': 'can tho',
    sapa: 'sapa',
    'quy nhơn': 'quy nhon',
    'hạ long': 'ha long',
  };

  constructor(
    private hotelsService: HotelsService,
    private roomsService: RoomsService,
    private roomAvailabilityService: RoomAvailabilityService,
  ) {}

  async getHotelsByCity(city: string) {
    try {
      // Chuẩn hóa tên thành phố
      const normalizedCity = this.normalizeCity(city);
      this.logger.log(
        `Tìm kiếm khách sạn với thành phố: "${normalizedCity}" (từ "${city}")`,
      );

      const query = normalizedCity
        ? `city=${encodeURIComponent(normalizedCity)}`
        : '';
      const hotels = await this.hotelsService.findAll(query, 1, 5);

      if (hotels.results && hotels.results.length > 0) {
        this.logger.log(
          `Tìm thấy ${hotels.results.length} khách sạn ở ${normalizedCity}`,
        );
      } else {
        this.logger.log(`Không tìm thấy khách sạn nào ở ${normalizedCity}`);
      }

      return hotels.results || [];
    } catch (error) {
      this.logger.error(`Error fetching hotels by city: ${error.message}`);
      return [];
    }
  }

  // Phương thức chuyển đổi tên thành phố từ dạng có dấu sang không dấu
  private normalizeCity(city: string): string {
    const lowerCity = city.toLowerCase();

    // Kiểm tra trong bản đồ ánh xạ
    if (this.cityMapping[lowerCity]) {
      return this.cityMapping[lowerCity];
    }

    // Trường hợp không có trong ánh xạ, thử chuyển đổi chung
    return this.removeDiacritics(city);
  }

  // Hàm loại bỏ dấu tiếng Việt
  private removeDiacritics(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, (match) => (match === 'đ' ? 'd' : 'D'));
  }

  async getHotelDetails(hotelId: string) {
    try {
      return await this.hotelsService.findOne(hotelId);
    } catch (error) {
      this.logger.error(`Error fetching hotel details: ${error.message}`);
      return null;
    }
  }

  async getHotelRooms(hotelId: string) {
    try {
      const rooms = await this.roomsService.findByHotel(hotelId, '', 1, 10);
      return rooms.results || [];
    } catch (error) {
      this.logger.error(`Error fetching hotel rooms: ${error.message}`);
      return [];
    }
  }

  async getHotelsByName(hotelName: string) {
    try {
      this.logger.log(`Tìm kiếm khách sạn với tên: "${hotelName}"`);

      // Sử dụng name query để tìm kiếm theo tên
      const query = `name=${encodeURIComponent(hotelName)}`;
      const hotels = await this.hotelsService.findAll(query, 1, 10);

      if (hotels.results && hotels.results.length > 0) {
        this.logger.log(
          `Tìm thấy ${hotels.results.length} khách sạn phù hợp với tên "${hotelName}"`,
        );
        return hotels.results;
      } else {
        this.logger.log(`Không tìm thấy khách sạn nào với tên "${hotelName}"`);
        return [];
      }
    } catch (error) {
      this.logger.error(`Error fetching hotels by name: ${error.message}`);
      return [];
    }
  }

  async checkRoomAvailability(
    roomId: string,
    startDate: string,
    endDate: string,
  ) {
    try {
      const availability =
        await this.roomAvailabilityService.checkRoomAvailabilityForDateRange(
          roomId,
          new Date(startDate),
          new Date(endDate),
        );
      return availability; // Trả về boolean trực tiếp
    } catch (error) {
      this.logger.error(`Error checking room availability: ${error.message}`);
      return false; // Trả về false thay vì object
    }
  }

  async getTopRatedHotels(limit: number = 5) {
    try {
      const hotels = await this.hotelsService.findAll('sort=-rating', 1, limit);
      return hotels.results || [];
    } catch (error) {
      this.logger.error(`Error fetching top rated hotels: ${error.message}`);
      return [];
    }
  }

  async getHotelsByPriceRange(minPrice: number, maxPrice?: number | null) {
    try {
      let query = `min_price=${minPrice}`;
      if (maxPrice !== null && maxPrice !== undefined) {
        query += `&max_price=${maxPrice}`;
      }
      // Thêm sắp xếp theo rating cao nhất
      query += '&sortBy=rating_desc';

      const hotels = await this.hotelsService.findAll(query, 1, 5);
      return hotels.results || [];
    } catch (error) {
      this.logger.error(
        `Error fetching hotels by price range: ${error.message}`,
      );
      return [];
    }
  }

  async getRoomsByTypeAndHotel(roomType: string, hotelId?: string) {
    try {
      let query = `room_type=${encodeURIComponent(roomType)}`;
      if (hotelId) {
        query += `&hotel_id=${hotelId}`;
      }

      const rooms = await this.roomsService.findAll(query, 1, 5);
      return rooms.results || [];
    } catch (error) {
      this.logger.error(`Error fetching rooms by type: ${error.message}`);
      return [];
    }
  }

  async getAvailableRoomsForHotel(
    hotelId: string,
    checkIn: string,
    checkOut: string,
  ) {
    try {
      // First get all rooms for the hotel
      const rooms = await this.getHotelRooms(hotelId);

      // Then check availability for each room
      const availableRooms = [];

      for (const room of rooms) {
        // Convert ObjectId to string
        const roomId = room._id.toString();

        const availability = await this.checkRoomAvailability(
          roomId,
          checkIn,
          checkOut,
        );

        // Sử dụng trực tiếp kết quả boolean
        if (availability) {
          availableRooms.push({
            ...room,
            available_count: room.number_of_rooms || 0,
          });
        }
      }
      return availableRooms;
    } catch (error) {
      this.logger.error(`Error fetching available rooms: ${error.message}`);
      return [];
    }
  }
}
