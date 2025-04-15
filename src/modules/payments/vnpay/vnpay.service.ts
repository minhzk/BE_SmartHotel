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

  private readonly vnpTmnCode =
    this.configService.get<string>('VNPAY_TMN_CODE');
  private readonly vnpHashSecret =
    this.configService.get<string>('VNPAY_HASH_SECRET');
  private readonly vnpUrl =
    this.configService.get<string>('VNPAY_URL') ||
    'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  private readonly vnpReturnUrl =
    this.configService.get<string>('VNPAY_RETURN_URL') ||
    'http://localhost:8080/api/v1/payments/vnpay-return';
  private readonly vnpApiUrl =
    this.configService.get<string>('VNPAY_API_URL') ||
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

    // Populate parameters without encoding OrderInfo yet
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

    let querystring = require('qs');
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let hmac = crypto.createHmac('sha512', secretKey);
    let signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    vnp_Params['vnp_SecureHash'] = signed;
    vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

    console.log('Final payment URL:', vnpUrl);

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

  // Thêm phương thức hoàn tiền VNPay
  async createRefundTransaction(
    paymentId: string,
    amount: number,
    description: string,
  ): Promise<any> {
    // Tìm giao dịch thanh toán gốc
    const originalPayment = await this.paymentModel.findOne({
      transaction_id: paymentId,
      payment_method: 'vnpay',
      status: PaymentStatus.COMPLETED,
    });

    if (!originalPayment) {
      throw new BadRequestException(
        'Original payment not found or not eligible for refund',
      );
    }

    // Tạo ID giao dịch hoàn tiền
    const refundTransactionId = `RF-${uuidv4().substring(0, 8)}`;

    // Tạo giao dịch hoàn tiền trong cơ sở dữ liệu
    const refundPayment = await this.paymentModel.create({
      transaction_id: refundTransactionId,
      booking_id: originalPayment.booking_id,
      user_id: originalPayment.user_id,
      amount: amount,
      payment_type: PaymentType.REFUND,
      payment_method: 'vnpay',
      status: PaymentStatus.PENDING,
      vnp_transaction_id: originalPayment.vnp_transaction_id,
      vnp_transaction_no: originalPayment.vnp_transaction_no,
      vnp_bank_code: originalPayment.vnp_bank_code,
    });

    // Trong môi trường thực tế, bạn sẽ gọi API hoàn tiền của VNPay ở đây
    // Sandbox của VNPay không hỗ trợ đầy đủ API Refund, nên chúng ta giả lập kết quả

    // Giả lập gọi API hoàn tiền thành công
    const refundResult = {
      success: true,
      refundId: refundTransactionId,
      message: 'Refund processed successfully',
      originalTransactionId: originalPayment.transaction_id,
    };

    // Cập nhật trạng thái giao dịch hoàn tiền
    await refundPayment.updateOne({
      status: PaymentStatus.REFUNDED,
      payment_date: new Date(),
      raw_response: refundResult,
    });

    return {
      transaction_id: refundTransactionId,
      original_transaction_id: originalPayment.transaction_id,
      amount: amount,
      status: PaymentStatus.REFUNDED,
      message: 'Refund processed successfully',
    };
  }

  // Helper function to sort parameters alphabetically and encode as required by VNPay
  private sortObject(obj: any) {
    let sorted = {};
    let str = [];
    let key;
    for (key in obj) {
      if (obj.hasOwnProperty(key)) {
        str.push(encodeURIComponent(key));
      }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
      sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+');
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
