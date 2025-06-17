const bcrypt = require('bcrypt');
const saltRounds = 10;

export const hashPasswordHelper = async (plainPassword: string) => {
    try {
        return await bcrypt.hash(plainPassword, saltRounds)
    } catch (error) {
        console.log(error);
    }
}

export const comparePasswordHelper = async (plainPassword: string, hashPassword: string) => {
    try {
        return await bcrypt.compare(plainPassword, hashPassword)
    } catch (error) {
        console.log(error);
    }
}

export const generateRandomCode = (length: number = 6): string => {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length)
    .toUpperCase();
};

export const generateNumericCode = (length: number = 6): string => {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0');
};

export const formatCurrency = (
  amount: number,
  currency: string = 'VND',
): string => {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency,
  }).format(amount);
};

export const removeVietnameseTones = (str: string): string => {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
};

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^(\+84|0)[3-9]\d{8}$/;
  return phoneRegex.test(phone);
};

export const generateBookingId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `BK-${timestamp}-${random}`.toUpperCase();
};

export const generatePaymentId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PAY-${timestamp}-${random}`.toUpperCase();
};

export const calculateDaysBetween = (
  startDate: Date,
  endDate: Date,
): number => {
  const timeDifference = endDate.getTime() - startDate.getTime();
  return Math.ceil(timeDifference / (1000 * 3600 * 24));
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const formatDateToString = (
  date: Date,
  format: string = 'YYYY-MM-DD',
): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  switch (format) {
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
    default:
      return `${year}-${month}-${day}`;
  }
};
