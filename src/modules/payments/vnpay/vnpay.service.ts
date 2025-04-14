import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import dayjs from 'dayjs';
import * as querystring from 'querystring';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Payment, PaymentStatus, PaymentType } from '../schemas/payment.schema';
import { CreateVnpayUrlDto } from '../dto/create-vnpay-url.dto';

@Injectable()
export class VnpayService {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Payment.name) private paymentModel: Model<Payment>,
  ) {}

  private readonly vnpTmnCode = '2QXUI4D4';
  private readonly vnpHashSecret = 'NYYZTXVJINTPXOFKGZDUGcohcgesyegp';
  private readonly vnpUrl =
    'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  private readonly vnpReturnUrl =
    this.configService.get<string>('VNPAY_RETURN_URL') ||
    'http://localhost:8080/api/v1/payments/vnpay-return';
  private readonly vnpApiUrl =
    'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
  private readonly ipnUrl =
    this.configService.get<string>('VNPAY_IPN_URL') ||
    'http://localhost:8080/api/v1/payments/vnpay-ipn';

  async createPaymentUrl(
    createDto: CreateVnpayUrlDto,
  ): Promise<{ payment: Payment; paymentUrl: string }> {
    const transactionId = `TP-${uuidv4().substring(0, 8)}`;

    // Tạo bản ghi thanh toán trong database
    const payment = await this.paymentModel.create({
      transaction_id: transactionId,
      booking_id: createDto.booking_id,
      user_id: createDto.user_id,
      amount: createDto.amount,
      payment_type: createDto.payment_type,
      payment_method: 'vnpay',
      status: PaymentStatus.PENDING,
      redirect_url: createDto.redirect_url,
      ipn_url: this.ipnUrl,
    });

    const tmnCode = this.vnpTmnCode;
    const secretKey = this.vnpHashSecret;
    let vnpUrl = this.vnpUrl;

    const returnUrl = createDto.redirect_url || this.vnpReturnUrl;
    const date = new Date();
    const createDate = dayjs(date).format('YYYYMMDDHHmmss');
    const orderId = payment._id.toString();
    const amount = createDto.amount * 100; // Convert to lowest currency unit (cents)

    const locale = 'vn';
    const currCode = 'VND';
    let vnp_Params = {};

    vnp_Params['vnp_Version'] = '2.1.0';
    vnp_Params['vnp_Command'] = 'pay';
    vnp_Params['vnp_TmnCode'] = tmnCode;
    vnp_Params['vnp_Locale'] = locale;
    vnp_Params['vnp_CurrCode'] = currCode;
    vnp_Params['vnp_TxnRef'] = orderId;
    vnp_Params['vnp_OrderInfo'] =
      `Thanh toan dat phong ${createDto.booking_id}`;
    vnp_Params['vnp_OrderType'] = 'other';
    vnp_Params['vnp_Amount'] = amount;
    vnp_Params['vnp_ReturnUrl'] = returnUrl;
    vnp_Params['vnp_IpAddr'] = createDto.client_ip || '127.0.0.1';
    vnp_Params['vnp_CreateDate'] = createDate;

    // Sắp xếp các field theo thứ tự a-z trước khi sign
    vnp_Params = this.sortObject(vnp_Params);

    // Tạo hmac
    const signData = querystring.stringify(vnp_Params);
    const hmac = crypto.createHmac('sha512', secretKey);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    vnp_Params['vnp_SecureHash'] = signed;

    // Tạo payment URL
    vnpUrl += '?' + querystring.stringify(vnp_Params);

    return { payment, paymentUrl: vnpUrl };
  }

  async processReturnUrl(vnpParams: any): Promise<any> {
    const secureHash = vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_SecureHashType'];

    // Sắp xếp các field theo thứ tự a-z trước khi verify
    const sortedParams = this.sortObject(vnpParams);
    const signData = querystring.stringify(sortedParams);
    const hmac = crypto.createHmac('sha512', this.vnpHashSecret);
    const calculatedHash = hmac
      .update(Buffer.from(signData, 'utf-8'))
      .digest('hex');

    // Verify signature
    if (secureHash !== calculatedHash) {
      throw new BadRequestException('Invalid signature');
    }

    const transactionRef = vnpParams['vnp_TxnRef'];
    const transactionStatus = vnpParams['vnp_TransactionStatus'];
    const transactionNo = vnpParams['vnp_TransactionNo'];
    const bankCode = vnpParams['vnp_BankCode'];

    // Tìm payment theo transaction reference
    const payment = await this.paymentModel.findById(transactionRef);
    if (!payment) {
      throw new BadRequestException('Payment not found');
    }

    // Cập nhật thông tin thanh toán
    const updateData: any = {
      vnp_transaction_id: vnpParams['vnp_TxnRef'],
      vnp_transaction_no: transactionNo,
      vnp_bank_code: bankCode,
      payment_date: new Date(),
      raw_response: vnpParams,
    };

    // Check transaction status from VNPay
    if (transactionStatus === '00') {
      // Payment successful
      updateData.status = PaymentStatus.COMPLETED;
    } else {
      // Payment failed
      updateData.status = PaymentStatus.FAILED;
      updateData.error_message = `Payment failed with code: ${transactionStatus}`;
    }

    // Update payment record
    await payment.updateOne(updateData);

    // Return updated payment
    return {
      success: transactionStatus === '00',
      paymentInfo: {
        transaction_id: payment.transaction_id,
        booking_id: payment.booking_id,
        amount: payment.amount,
        status: updateData.status,
        vnp_response_code: transactionStatus,
      },
    };
  }

  // IPN: Instant Payment Notification - used for server-to-server communication
  async processIpnUrl(vnpParams: any): Promise<any> {
    // Process similar to return URL but for server-side notification
    // Implementation will depend on your specific needs
    const result = await this.processReturnUrl(vnpParams);

    // Return RspCode and Message as required by VNPay IPN API
    return {
      RspCode: result.success ? '00' : '99',
      Message: result.success ? 'Confirm Success' : 'Confirm Fail',
    };
  }

  // Helper function to sort parameters alphabetically
  private sortObject(obj: any) {
    const sorted: any = {};
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      if (obj.hasOwnProperty(key)) {
        sorted[key] = obj[key];
      }
    }

    return sorted;
  }

  // Query payment status from VNPay
  async queryTransactionStatus(transactionId: string): Promise<any> {
    const payment = await this.paymentModel.findOne({
      transaction_id: transactionId,
    });
    if (!payment) {
      throw new BadRequestException('Payment not found');
    }

    // In a real implementation, you would call VNPay's queryDr API here
    // For demo purposes, we'll just return the current status
    return {
      transaction_id: payment.transaction_id,
      booking_id: payment.booking_id,
      status: payment.status,
      amount: payment.amount,
      payment_date: payment.payment_date,
    };
  }
}
