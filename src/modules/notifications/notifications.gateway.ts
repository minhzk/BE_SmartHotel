import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private userSockets: Map<string, string[]> = new Map();

  constructor(private jwtService: JwtService) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token = client.handshake.auth.token?.split(' ')[1];
      if (!token) {
        this.logger.error('No token provided');
        client.disconnect();
        return;
      }

      // Verify token
      const payload = this.jwtService.verify(token);
      const userId = payload.sub;

      // Store socket connection
      const userConnections = this.userSockets.get(userId) || [];
      userConnections.push(client.id);
      this.userSockets.set(userId, userConnections);

      this.logger.log(`Client connected: ${client.id} for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Remove socket connection
    for (const [userId, sockets] of this.userSockets.entries()) {
      const index = sockets.indexOf(client.id);
      if (index !== -1) {
        sockets.splice(index, 1);
        if (sockets.length === 0) {
          this.userSockets.delete(userId);
        } else {
          this.userSockets.set(userId, sockets);
        }
        this.logger.log(
          `Client disconnected: ${client.id} for user: ${userId}`,
        );
        break;
      }
    }
  }

  sendNotificationToUser(userId: string, notification: any) {
    const sockets = this.userSockets.get(userId);
    if (sockets && sockets.length > 0) {
      sockets.forEach((socketId) => {
        this.server.to(socketId).emit('notification', notification);
      });
      this.logger.log(`Notification sent to user ${userId}`);
      return true;
    }
    this.logger.log(`User ${userId} is not connected`);
    return false;
  }
}
