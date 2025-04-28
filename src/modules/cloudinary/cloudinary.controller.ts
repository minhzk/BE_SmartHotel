import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('uploads')
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Public()
  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  @ResponseMessage('Upload image successfully')
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return await this.cloudinaryService.uploadFile(file);
  }

  @Public()
  @Post('base64')
  @ResponseMessage('Upload base64 image successfully')
  async uploadBase64(
    @Body() body: { base64Image: string; description?: string },
  ) {
    if (!body.base64Image) {
      throw new BadRequestException('No base64 image provided');
    }

    const result = await this.cloudinaryService.uploadBase64Image(
      body.base64Image,
      body.description,
    );

    // Đảm bảo log đúng public_id từ Cloudinary
    console.log('Cloudinary upload result:', {
      public_id: result.public_id,
      secure_url: result.secure_url,
    });

    return result; // Đảm bảo trả về đầy đủ thông tin
  }
}
