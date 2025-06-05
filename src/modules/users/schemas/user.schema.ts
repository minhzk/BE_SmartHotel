import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop()
  name: string;

  @Prop()
  email: string;

  @Prop()
  password: string;

  @Prop()
  phone: string;

  @Prop()
  image: string;

  @Prop({ default: 'USER' })
  role: string;

  @Prop({ default: false })
  isActive: boolean;

  @Prop()
  codeId: string;

  @Prop()
  codeExpired: Date;

  // Thêm trường balance cho ví nội bộ
  @Prop({ default: 0 })
  account_balance: number;

  // Thêm trường transactions để lưu lịch sử giao dịch
  @Prop([
    {
      type: {
        type: String,
        enum: ['DEPOSIT', 'REFUND', 'PAYMENT', 'WITHDRAWAL'],
        required: true,
      },
      amount: {
        type: Number,
        required: true,
      },
      description: String,
      reference_id: String,
      created_at: {
        type: Date,
        default: Date.now,
      },
    },
  ])
  transactions: Record<string, any>[];

  @Prop()
  authProvider: string;

  @Prop()
  googleId: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
