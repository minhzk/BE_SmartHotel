import { IS_PUBLIC_KEY } from '@/decorator/customize';
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    // Add your custom authentication logic here
    // for example, call super.logIn(request) to establish a session.
    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    // Xử lý cụ thể cho token hết hạn
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException({
        message: 'Access token has expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    // Xử lý lỗi token không hợp lệ
    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException({
        message: 'Invalid access token',
        code: 'TOKEN_INVALID',
      });
    }

    // Xử lý các lỗi khác
    if (err || !user) {
      throw (
        err ||
        new UnauthorizedException('Access token is invalid or not provided')
      );
    }

    return user;
  }
}
