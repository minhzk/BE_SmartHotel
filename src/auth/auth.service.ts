
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '@/modules/users/users.service';
import { comparePasswordHelper } from '@/utils/helper';
import { JwtService } from '@nestjs/jwt';
import { User } from '@/modules/users/schemas/user.schema';
import { ChangePasswordAuthDto, CodeAuthDto, CreateAuthDto } from './dto/create-auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(username);
    if(!user) return null
    const isValidPassword = await comparePasswordHelper(pass, user.password)
    if (!isValidPassword) return null;
    const userObject = user.toObject();
    const { password, ...result } = userObject;
    
    return result;
  }

  async login(user: any) {
    const payload = { username: user.email, sub: user._id };
    return {
      user: {
        email: user.email,
        _id: user._id,
        name: user?.name
      },
      access_token: this.jwtService.sign(payload),
    };
  }

  handleRegister = async(registerDto: CreateAuthDto) => {
    return await this.usersService.handleUserRegister(registerDto)
  }

  checkCode = async(checkCodeDto: CodeAuthDto) => {
    return await this.usersService.handleActive(checkCodeDto)
  }

  retryActive = async(data: string) => {
    return await this.usersService.retryActive(data)
  }

  retryPassword = async(data: string) => {
    return await this.usersService.retryPassword(data)
  }

  changePassword = async(data: ChangePasswordAuthDto) => {
    return await this.usersService.changePassword(data)
  }
}
