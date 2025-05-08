import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty()
  @IsString()
  session_id: string;

  @IsNotEmpty()
  @IsString()
  message: string;
  
  @IsOptional()
  @IsBoolean()
  is_general_mode?: boolean;
  
  @IsOptional()
  @IsObject()
  capabilities?: {
    hotel_queries?: boolean;
    room_queries?: boolean;
    booking_assistance?: boolean;
  };
}
