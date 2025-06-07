import { IsEmail, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @MinLength(6)
  password: string;

  @IsOptional()
  phone: string;

  @IsOptional()
  image: string;

  @IsOptional()
  role: string;

  @IsOptional()
  isActive: string;
}
