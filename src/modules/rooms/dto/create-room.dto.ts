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
  SINGLE = 'Single',
  TWIN = 'Twin',
  DOUBLE = 'Double',
  QUEEN = 'Queen',
  KING = 'King',
  BUNK = 'Bunk',
  SOFA_BED = 'Sofa bed',
}

class ImageDto {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  description: string;
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
  @IsOptional()
  images: ImageDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BedConfigurationDto)
  @IsOptional()
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

  @IsBoolean()
  @IsOptional()
  is_active: boolean = true;
}
