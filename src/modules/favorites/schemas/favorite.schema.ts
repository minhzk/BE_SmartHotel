import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

export type FavoriteDocument = HydratedDocument<Favorite>;

@Schema({ timestamps: true })
export class Favorite {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
  user_id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel', required: true })
  hotel_id: string;
}

// Tạo compound index cho cặp user_id và hotel_id để đảm bảo không trùng lặp
export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
FavoriteSchema.index({ user_id: 1, hotel_id: 1 }, { unique: true });
