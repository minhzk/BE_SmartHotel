import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Request,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { ResponseMessage } from '@/decorator/customize';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post()
  @ResponseMessage('Add hotel to favorites successfully')
  create(@Request() req, @Body() createFavoriteDto: CreateFavoriteDto) {
    return this.favoritesService.create(req.user._id, createFavoriteDto);
  }

  @Get()
  @ResponseMessage('Fetch favorites successfully')
  findAll(@Request() req) {
    return this.favoritesService.findAllByUser(req.user._id);
  }

  @Get('check/:hotelId')
  @ResponseMessage('Check if hotel is in favorites')
  checkIfFavorite(@Request() req, @Param('hotelId') hotelId: string) {
    return this.favoritesService.checkIfFavorite(req.user._id, hotelId);
  }

  @Delete(':hotelId')
  @ResponseMessage('Remove hotel from favorites successfully')
  remove(@Request() req, @Param('hotelId') hotelId: string) {
    return this.favoritesService.remove(req.user._id, hotelId);
  }
}
