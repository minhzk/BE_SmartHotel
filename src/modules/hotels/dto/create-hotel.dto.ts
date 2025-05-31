import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class LocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}

class ImageDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsOptional()
  cloudinary_id: string; // Add cloudinary_id to ImageDto
}

class AISummaryDto {
  @IsString()
  @IsOptional()
  short_description: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  highlight_features: string[];

  @IsNumber()
  @IsOptional()
  average_sentiment: number;

  @IsOptional()
  last_updated: Date;
}

export enum CityEnum {
  HA_NOI = 'ha noi',
  HO_CHI_MINH = 'ho chi minh',
  DA_NANG = 'da nang',
  NHA_TRANG = 'nha trang',
  DA_LAT = 'da lat',
  PHU_QUOC = 'phu quoc',
  HUE = 'hue',
  QUY_NHON = 'quy nhon',
  VUNG_TAU = 'vung tau',
}

export class CreateHotelDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  // Sử dụng enum cho city
  city: CityEnum;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsOptional()
  rating: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities: string[];

  @ValidateNested()
  @Type(() => LocationDto)
  @IsOptional()
  location: LocationDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  @IsNotEmpty()
  images: ImageDto[];

  @IsBoolean()
  @IsOptional()
  is_active: boolean;

  @IsBoolean()
  @IsOptional()
  accept_deposit: boolean = false;

  @ValidateNested()
  @Type(() => AISummaryDto)
  @IsOptional()
  ai_summary: AISummaryDto;

  @IsNumber()
  @IsNotEmpty()
  min_price: number;

  @IsNumber()
  @IsNotEmpty()
  max_price: number;

  @IsNumber()
  @IsNotEmpty()
  max_capacity: number;
}
