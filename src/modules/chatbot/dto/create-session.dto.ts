import { IsOptional, IsString, IsObject, IsBoolean } from 'class-validator';

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  hotel_id?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsObject()
  capabilities?: {
    hotel_queries?: boolean;
    room_queries?: boolean;
    booking_assistance?: boolean;
  };

  @IsOptional()
  @IsString()
  system_context?: string;

  @IsOptional()
  @IsObject()
  user_info?: {
    id?: string;
    name?: string;
    email?: string;
  };

  @IsOptional()
  @IsString()
  user_id?: string;
}
