import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '@/modules/users/users.service';
import { comparePasswordHelper } from '@/utils/helper';
import { JwtService } from '@nestjs/jwt';
import { User } from '@/modules/users/schemas/user.schema';
import {
  ChangePasswordAuthDto,
  CodeAuthDto,
  CreateAuthDto,
} from './dto/create-auth.dto';
import { AuthTokenService } from './auth-token.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private authTokenService: AuthTokenService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(username);
    if (!user) return null;
    const isValidPassword = await comparePasswordHelper(pass, user.password);
    if (!isValidPassword) return null;
    const userObject = user.toObject();
    const { password, ...result } = userObject;

    return result;
  }

  async login(user: any) {
    const payload = { username: user.email, sub: user._id };
    const tokens = this.authTokenService.generateTokens(payload);

    return {
      user: {
        email: user.email,
        _id: user._id,
        name: user?.name,
        phone: user?.phone,
        role: user?.role,
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async refreshToken(refreshToken: string) {
    // Verify refresh token
    const payload = this.authTokenService.verifyRefreshToken(refreshToken);

    if (!payload) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Get user from database to ensure they still exist and are active
    const user = await this.usersService.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Generate new tokens
    const newPayload = { username: payload.username, sub: payload.sub };
    const tokens = this.authTokenService.generateTokens(newPayload);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  handleRegister = async (registerDto: CreateAuthDto) => {
    return await this.usersService.handleUserRegister(registerDto);
  };

  checkCode = async (checkCodeDto: CodeAuthDto) => {
    return await this.usersService.handleActive(checkCodeDto);
  };

  retryActive = async (data: string) => {
    return await this.usersService.retryActive(data);
  };

  retryPassword = async (data: string) => {
    return await this.usersService.retryPassword(data);
  };

  changePassword = async (data: ChangePasswordAuthDto) => {
    return await this.usersService.changePassword(data);
  };

  async validateGoogleUser(googleUser: any) {
    console.log('Validating Google user:', googleUser);

    const { email, picture, sub, name } = googleUser;

    // Check if user already exists
    let user = await this.usersService.findByEmail(email);
    console.log('Existing user found:', !!user);

    if (!user) {
      // Create new user if doesn't exist
      const userData = {
        email,
        name,
        password: '', // No password for Google users
        image: picture,
        isActive: true,
        authProvider: 'google',
        googleId: sub, // Use 'sub' which is the Google user ID
      };

      console.log('Creating new Google user:', userData);
      user = await this.usersService.createGoogleUser(userData);
    } else {
      // Update existing user with Google info if needed
      if (!user.authProvider || user.authProvider !== 'google') {
        console.log('Updating existing user with Google provider');
        await this.usersService.updateUserProvider(
          user._id.toString(),
          'google',
          picture,
        );
      }
    }

    console.log('Final validated user:', user);
    return user;
  }

  async googleLogin(user: any) {
    const payload = { username: user.email, sub: user._id };
    const tokens = this.authTokenService.generateTokens(payload);

    return {
      user: {
        email: user.email,
        _id: user._id,
        name: user?.name,
        phone: user?.phone,
        role: user?.role,
        image: user?.image,
        authProvider: user?.authProvider,
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }
}
