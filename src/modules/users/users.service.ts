import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { Model } from 'mongoose';
import { hashPasswordHelper } from '@/utils/helper';
import aqp from 'api-query-params';
import mongoose from 'mongoose';
import {
  ChangePasswordAuthDto,
  CodeAuthDto,
  CreateAuthDto,
} from '@/auth/dto/create-auth.dto';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,
    private readonly mailerService: MailerService,
  ) {}

  isEmailExist = async (email: string) => {
    const user = await this.userModel.exists({ email });
    if (user) return true;
    return false;
  };
  async create(createUserDto: CreateUserDto) {
    const { name, email, password, phone, image, role, isActive } =
      createUserDto;

    //check email
    const isExist = await this.isEmailExist(email);
    if (isExist) {
      throw new BadRequestException(`Email: ${email} already exists`);
    }

    // hash password
    const hashPassword = await hashPasswordHelper(password);
    const user = await this.userModel.create({
      name,
      email,
      password: hashPassword,
      phone,
      image,
      role: role || 'USER', // default to 'user' if not provided
      isActive: isActive !== undefined ? isActive : true, // default to true if not provided
    });
    return {
      _id: user._id,
    };
  }

  async findAll(
    query: any,
    current: number,
    pageSize: number,
    search?: string,
    role?: string,
    isActive?: string,
  ) {
    const { filter, sort } = aqp(query);

    // Clean up filter object
    if (filter.current) delete filter.current;
    if (filter.pageSize) delete filter.pageSize;
    if (filter.search) delete filter.search;

    // Set defaults for pagination
    if (!current) current = 1;
    if (!pageSize) pageSize = 10;

    // Build the filter object
    const finalFilter: any = { ...filter };

    // Add search functionality across multiple fields
    if (search) {
      finalFilter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    // Add role filter
    if (role) {
      finalFilter.role = role;
    }

    // Add isActive filter (convert string to boolean)
    if (isActive !== undefined) {
      finalFilter.isActive = isActive === 'true';
    }

    const totalItems = await this.userModel.countDocuments(finalFilter);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (current - 1) * pageSize;

    const results = await this.userModel
      .find(finalFilter)
      .limit(pageSize)
      .skip(skip)
      .select('-password')
      .sort(sort as any);

    return {
      meta: {
        current: current,
        pageSize: pageSize,
        pages: totalPages,
        total: totalItems,
      },
      results,
    };
  }

  async findByEmail(email: string) {
    return await this.userModel.findOne({ email });
  }

  async findUserById(userId: string) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel
      .findById(userId)
      .select('-password -codeId -codeExpired');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return user;
  }

  async update(updateUserDto: UpdateUserDto) {
    return await this.userModel.updateOne(
      { _id: updateUserDto._id },
      { ...updateUserDto },
    );
  }

  async remove(_id: string) {
    // check id
    if (mongoose.isValidObjectId(_id)) {
      // delete
      return this.userModel.deleteOne({ _id });
    } else {
      throw new BadRequestException('Invalid id');
    }
  }

  async handleUserRegister(registerDto: CreateAuthDto) {
    const { name, email, password } = registerDto;

    //check email
    const isExist = await this.isEmailExist(email);
    if (isExist) {
      throw new BadRequestException(`Email: ${email} already exists`);
    }

    // hash password
    const hashPassword = await hashPasswordHelper(password);
    const codeId = uuidv4();
    const user = await this.userModel.create({
      name,
      email,
      password: hashPassword,
      isActive: false,
      codeId: codeId,
      codeExpired: dayjs().add(5, 'minutes'),
    });

    // send email
    this.mailerService.sendMail({
      to: user.email, // list of receivers
      subject: 'Activate your account at Smart Hotel', // Subject line
      template: 'register',
      context: {
        name: user?.name ?? user.email,
        activationCode: codeId,
      },
    });

    // return feedback to user
    return {
      _id: user._id,
    };
  }

  async handleActive(checkCodeDto: CodeAuthDto) {
    const user = await this.userModel.findOne({
      _id: checkCodeDto._id,
      codeId: checkCodeDto.code,
    });
    if (!user) {
      throw new BadRequestException('Code invalid or expired');
    }

    // check expired code
    const isBeforeCheck = dayjs().isBefore(user.codeExpired);
    if (isBeforeCheck) {
      // valid => update user
      await this.userModel.updateOne(
        { _id: checkCodeDto._id },
        {
          isActive: true,
        },
      );
      return { isBeforeCheck };
    } else {
      throw new BadRequestException('Code invalid or expired');
    }
  }

  async retryActive(email: string) {
    // check email
    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new BadRequestException('Email not found');
    }
    if (user.isActive) {
      throw new BadRequestException('Account already active');
    }

    // create code
    const codeId = uuidv4();

    //update user
    await user.updateOne({
      codeId: codeId,
      codeExpired: dayjs().add(5, 'minutes'),
    });

    //send email
    this.mailerService.sendMail({
      to: user.email, // list of receivers
      subject: 'Activate your account at Smart Hotel', // Subject line
      template: 'register',
      context: {
        name: user?.name ?? user.email,
        activationCode: codeId,
      },
    });
    return { _id: user._id };
  }

  async retryPassword(email: string) {
    // check email
    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new BadRequestException('Email not found');
    }

    // create code
    const codeId = uuidv4();

    //update user
    await user.updateOne({
      codeId: codeId,
      codeExpired: dayjs().add(5, 'minutes'),
    });

    //send email
    this.mailerService.sendMail({
      to: user.email, // list of receivers
      subject: 'Change your password at Smart Hotel', // Subject line
      template: 'password-reset',
      context: {
        name: user?.name ?? user.email,
        activationCode: codeId,
      },
    });
    return { _id: user._id, email: user.email };
  }

  async changePassword(data: ChangePasswordAuthDto) {
    // check password match
    if (data.confirmPassword !== data.password) {
      throw new BadRequestException('Mật khẩu và xác nhận mật khẩu không khớp');
    }

    // check email
    const user = await this.userModel.findOne({ email: data.email });

    if (!user) {
      throw new BadRequestException('Email not found');
    }

    // check expired code
    const isBeforeCheck = dayjs().isBefore(user.codeExpired);
    if (isBeforeCheck && user.codeId === data.code) {
      // valid => update password
      const newPassword = await hashPasswordHelper(data.password);
      await user.updateOne({ password: newPassword });
      return { isBeforeCheck };
    } else {
      throw new BadRequestException('Code invalid or expired');
    }
  }

  async updateWalletBalance(
    userId: string,
    amount: number,
    description: string,
    transactionId: string,
  ): Promise<any> {
    // Tìm user
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Cập nhật số dư và thêm giao dịch
    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $inc: { account_balance: amount },
        $push: {
          transactions: {
            type: amount > 0 ? 'DEPOSIT' : 'WITHDRAW',
            amount,
            description,
            reference_id: transactionId,
            created_at: new Date(),
          },
        },
      },
      { new: true },
    );

    return {
      user_id: updatedUser._id,
      new_balance: updatedUser.account_balance,
      transaction:
        updatedUser.transactions[updatedUser.transactions.length - 1],
    };
  }

  async createGoogleUser(userData: any) {
    const user = await this.userModel.create(userData);
    return user;
  }

  async updateUserProvider(userId: string, provider: string, image?: string) {
    const updateData: any = { authProvider: provider };
    if (image) {
      updateData.image = image;
    }

    return await this.userModel.updateOne({ _id: userId }, updateData);
  }
}
