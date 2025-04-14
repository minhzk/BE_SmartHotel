import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class WalletDepositDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(10000) // Minimum deposit amount (e.g., 10,000 VND)
  amount: number;

  @IsString()
  @IsOptional()
  redirect_url?: string;

  @IsString()
  @IsOptional()
  client_ip?: string;
}
