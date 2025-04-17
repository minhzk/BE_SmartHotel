import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Request,
  Res,
  Response,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { WalletDepositDto } from './dto/wallet-deposit.dto';
import { Public, ResponseMessage } from '@/decorator/customize';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get('vnpay-return')
  async processVnpayReturn(
    @Query() query: any,
    @Res() res, // Loại bỏ { passthrough: true }
  ) {
    try {
      await this.paymentsService.processVnpayReturnWithRedirect(query, res);
      // Không return gì ở đây vì response đã được xử lý trong service
    } catch (error) {
      console.error('Error processing payment:', error);
      const frontendUrl = new URL(this.paymentsService.getFrontendResultUrl());
      frontendUrl.searchParams.append('success', 'false');
      frontendUrl.searchParams.append(
        'error',
        error.message || 'Payment processing failed',
      );
      res.redirect(frontendUrl.toString());
    }
  }

  @Public()
  @Get('vnpay-ipn')
  @ResponseMessage('Process VNPay IPN successfully')
  processVnpayIpn(@Query() query: any) {
    return this.paymentsService.processVnpayIpn(query);
  }

  @Post()
  @ResponseMessage('Create payment successfully')
  createPayment(@Request() req, @Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.createPayment(req.user._id, createPaymentDto);
  }

  @Get()
  @ResponseMessage('Fetch payments successfully')
  findAll(
    @Request() req,
    @Query() query: string,
    @Query('current') current: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.paymentsService.findAll(
      req.user._id,
      query,
      +current,
      +pageSize,
    );
  }

  @Get(':id')
  @ResponseMessage('Fetch payment successfully')
  findOne(@Request() req, @Param('id') id: string) {
    return this.paymentsService.findOne(id, req.user._id);
  }

  @Get(':id/status')
  @ResponseMessage('Fetch payment status successfully')
  getPaymentStatus(@Request() req, @Param('id') id: string) {
    return this.paymentsService.getPaymentStatus(id, req.user._id);
  }

  @Post('wallet/deposit')
  @ResponseMessage('Create wallet deposit successfully')
  depositToWallet(@Request() req, @Body() walletDepositDto: WalletDepositDto) {
    const clientIp =
      req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    return this.paymentsService.depositToWallet(
      req.user._id,
      walletDepositDto.amount,
      clientIp,
      walletDepositDto.redirect_url,
    );
  }

  // @Post(':id/retry')
  // @ResponseMessage('Retry failed payment successfully')
  // retryFailedPayment(@Request() req, @Param('id') id: string) {
  //   return this.paymentsService.retryFailedPayment(id, req.user._id);
  // }
}
