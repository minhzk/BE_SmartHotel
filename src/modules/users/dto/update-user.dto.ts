import { IsMongoId, IsNotEmpty, IsOptional } from "class-validator";

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
}
