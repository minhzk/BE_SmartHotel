import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Favorite } from './schemas/favorite.schema';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import mongoose from 'mongoose';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name)
    private favoriteModel: Model<Favorite>,
  ) {}

  async create(userId: string, createFavoriteDto: CreateFavoriteDto) {
    try {
      const newFavorite = await this.favoriteModel.create({
        user_id: userId,
        hotel_id: createFavoriteDto.hotel_id,
      });
      return newFavorite;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate key error
        throw new BadRequestException('Hotel already in favorites');
      }
      throw error;
    }
  }

  async findAllByUser(userId: string) {
    return await this.favoriteModel
      .find({ user_id: userId })
      .populate(
        'hotel_id',
        'name address city rating images min_price max_price amenities max_capacity sentiment_score sentiment_label total_reviews',
      )
      .exec();
  }

  async checkIfFavorite(userId: string, hotelId: string) {
    const favorite = await this.favoriteModel.findOne({
      user_id: userId,
      hotel_id: hotelId,
    });
    return !!favorite;
  }

  async remove(userId: string, hotelId: string) {
    if (!mongoose.isValidObjectId(hotelId)) {
      throw new BadRequestException('Invalid hotel ID');
    }

    const result = await this.favoriteModel.deleteOne({
      user_id: userId,
      hotel_id: hotelId,
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Favorite not found');
    }

    return { deleted: true };
  }
}
