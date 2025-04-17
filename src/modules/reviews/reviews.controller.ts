import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Request,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateResponseDto, UpdateReviewDto } from './dto/update-review.dto';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ResponseMessage('Create review successfully')
  create(@Request() req, @Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(req.user._id, createReviewDto);
  }

  @Get()
  @Public()
  @ResponseMessage('Fetch reviews successfully')
  findAll(
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.reviewsService.findAll(query, +current, +pageSize);
  }

  @Get('hotel/:hotelId')
  @Public()
  @ResponseMessage('Fetch hotel reviews successfully')
  findByHotel(
    @Param('hotelId') hotelId: string,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.reviewsService.findByHotel(hotelId, query, +current, +pageSize);
  }

  @Get('user')
  @ResponseMessage('Fetch user reviews successfully')
  findByUser(
    @Request() req,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.reviewsService.findByUser(
      req.user._id,
      query,
      +current,
      +pageSize,
    );
  }

  @Get(':id')
  @Public()
  @ResponseMessage('Fetch review successfully')
  findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }

  @Patch()
  @ResponseMessage('Update review successfully')
  update(@Request() req, @Body() updateReviewDto: UpdateReviewDto) {
    return this.reviewsService.update(req.user._id, updateReviewDto);
  }

  @Post('response')
  @ResponseMessage('Create review response successfully')
  createResponse(@Request() req, @Body() createResponseDto: CreateResponseDto) {
    return this.reviewsService.createResponse(req.user._id, createResponseDto);
  }

  @Delete(':id')
  @ResponseMessage('Delete review successfully')
  remove(@Request() req, @Param('id') id: string) {
    return this.reviewsService.remove(req.user._id, id);
  }
}
