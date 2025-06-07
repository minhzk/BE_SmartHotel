import { IsMongoId, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class UpdateUserDto {
  @IsMongoId()
  @IsNotEmpty()
  _id: string;

  @IsOptional()
  name: string;

  @IsOptional()
  phone: string;

  @IsOptional()
  image: string;

  @IsOptional()
  role: string;

  @IsOptional()
  @IsBoolean()
  isActive: boolean;
}
