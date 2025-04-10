import { IsNotEmpty, IsOptional, MinLength } from "class-validator";

export class CreateAuthDto {
    @IsNotEmpty()
    email: string;

    @IsOptional()
    @IsNotEmpty()
    name: string;

    @MinLength(6)
    password: string;
}

export class CodeAuthDto {
    @IsNotEmpty()
    _id: string;

    @IsNotEmpty()
    code: string;
}

export class ChangePasswordAuthDto {
    @IsNotEmpty()
    code: string;

    @IsNotEmpty()
    email: string;

    @IsNotEmpty()
    password: string;

    @IsNotEmpty()
    confirmPassword: string;
}
