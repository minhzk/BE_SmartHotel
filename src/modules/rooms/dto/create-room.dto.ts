import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export enum RoomType {
  STANDARD = 'Standard',
  DELUXE = 'Deluxe',
  SUITE = 'Suite',
  EXECUTIVE = 'Executive',
  FAMILY = 'Family',
  VILLA = 'Villa',
  BUNGALOW = 'Bungalow',
  STUDIO = 'Studio',
  CONNECTING = 'Connecting',
  ACCESSIBLE = 'Accessible',
  PENTHOUSE = 'Penthouse',
  PRESIDENTIAL = 'Presidential',
}

export enum BedType {
  SINGLE = 'single',
  DOUBLE = 'double',
  QUEEN = 'queen',
  KING = 'king',
  TWIN = 'twin',
  SOFA = 'sofa_bed',
  BUNK = 'bunk_bed',
  MURPHY = 'murphy_bed',
  FUTON = 'futon',
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
  cloudinary_id: string;
}

class BedConfigurationDto {
  @IsEnum(BedType)
  type: BedType;

  @IsNumber()
  count: number;
}

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  hotel_id: string;

  @IsEnum(RoomType)
  @IsNotEmpty()
  room_type: RoomType;

  @IsNumber()
  @IsNotEmpty()
  price_per_night: number;

  @IsNumber()
  @IsOptional()
  capacity: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  @IsNotEmpty()
  images: ImageDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BedConfigurationDto)
  @IsNotEmpty()
  bed_configuration: BedConfigurationDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities: string[];

  @IsNumber()
  @IsOptional()
  size: number;

  @IsNumber()
  @IsOptional()
  max_adults: number = 1;

  @IsNumber()
  @IsOptional()
  max_children: number = 0;

  @IsNumber()
  @IsOptional()
  number_of_rooms: number = 1;

  @IsBoolean()
  @IsOptional()
  is_bookable: boolean = true;

  @IsBoolean()
  @IsOptional()
  is_active: boolean = true;
}
