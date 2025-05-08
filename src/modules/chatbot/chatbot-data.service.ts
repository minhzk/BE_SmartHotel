import { Injectable, Logger } from '@nestjs/common';
import { HotelsService } from '../hotels/hotels.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomAvailabilityService } from '../room-availability/room-availability.service';
import { ObjectId } from 'mongoose';

@Injectable()
export class ChatbotDataService {
  private readonly logger = new Logger(ChatbotDataService.name);

  constructor(
    private hotelsService: HotelsService,
    private roomsService: RoomsService,
    private roomAvailabilityService: RoomAvailabilityService,
  ) {}

  async getHotelsByCity(city: string) {
    try {
      const query = city ? `city=${encodeURIComponent(city)}` : '';
      const hotels = await this.hotelsService.findAll(query, 1, 5);
      return hotels.results || [];
    } catch (error) {
      this.logger.error(`Error fetching hotels by city: ${error.message}`);
      return [];
    }
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

  async getHotelsByPriceRange(minPrice: number, maxPrice: number) {
    try {
      const query = `min_price=${minPrice}&max_price=${maxPrice}`;
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
