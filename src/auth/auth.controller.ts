import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './passport/local-auth.guard';
import { Public, ResponseMessage } from '@/decorator/customize';
import {
  ChangePasswordAuthDto,
  CodeAuthDto,
  CreateAuthDto,
} from './dto/create-auth.dto';
import { MailerService } from '@nestjs-modules/mailer';
import { GoogleOauthGuard } from './passport/google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mailerService: MailerService,
  ) {}

  @Post('login')
  @Public()
  @UseGuards(LocalAuthGuard)
  @ResponseMessage('Fetch login')
  handleLogin(@Request() req) {
    return this.authService.login(req.user);
  }

  // @UseGuards(JwtAuthGuard)
  @Post('register')
  @Public()
  register(@Body() registerDto: CreateAuthDto) {
    return this.authService.handleRegister(registerDto);
  }

  @Post('check-code')
  @Public()
  checkCode(@Body() checkCodeDto: CodeAuthDto) {
    return this.authService.checkCode(checkCodeDto);
  }

  @Post('retry-active')
  @Public()
  retryActive(@Body('email') email: string) {
    return this.authService.retryActive(email);
  }

  @Post('retry-password')
  @Public()
  retryPassword(@Body('email') email: string) {
    return this.authService.retryPassword(email);
  }

  @Post('change-password')
  @Public()
  changePassword(@Body() data: ChangePasswordAuthDto) {
    return this.authService.changePassword(data);
  }

  @Post('refresh')
  @Public()
  @ResponseMessage('Refresh access token')
  async refreshToken(@Body('refresh_token') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('mail')
  @Public()
  testMail() {
    this.mailerService.sendMail({
      to: 'minhdev158@gmail.com', // list of receivers
      subject: 'Testing Nest MailerModule ✔', // Subject line
      text: 'welcome', // plaintext body
      template: 'register',
      context: {
        name: 'Minh',
        activationCode: 12312313123,
      },
    });
    return 'ok';
  }

  @Get('google')
  @Public()
  @UseGuards(GoogleOauthGuard)
  async googleAuth() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleOauthGuard)
  async googleAuthRedirect(@Request() req) {
    const result = await this.authService.googleLogin(req.user);

    // Redirect to frontend with tokens
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/auth/google/callback?token=${result.access_token}&refresh_token=${result.refresh_token}`;

    return { url: redirectUrl };
  }

  @Post('google/signin')
  @Public()
  @ResponseMessage('Google sign-in')
  async googleSignIn(@Body() googleData: any) {
    try {
      const { email, name, image, googleId } = googleData;

      const googleUser = {
        email,
        name,
        picture: image,
        sub: googleId, // Use googleId as sub
      };

      const user = await this.authService.validateGoogleUser(googleUser);
      return this.authService.googleLogin(user);
    } catch (error) {
      throw error;
    }
  }
}
