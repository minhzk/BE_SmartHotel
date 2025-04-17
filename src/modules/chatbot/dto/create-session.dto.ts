import { IsOptional, IsString } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsOptional()
  user_id?: string;

  @IsString()
  @IsOptional()
  hotel_id?: string;
}
