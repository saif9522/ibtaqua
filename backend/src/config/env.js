const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  OTP_TTL_MINUTES: z.coerce.number().default(5),
  OTP_DEV_ECHO: z.string().default('true'), // returns OTP in API response in dev only
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  SMS_PROVIDER: z.string().default('console'), // console | msg91 | twilio
  SMS_API_KEY: z.string().default(''),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_ID: z.string().default(''),
  SMTP_URL: z.string().default(''),
  FCM_SERVER_KEY: z.string().default(''),
  UPLOAD_DIR: z.string().default('src/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
  BACKUP_DIR: z.string().default('backups'),
  ENABLE_JOBS: z.string().default('true'),
});

const env = schema.parse(process.env);

if (env.NODE_ENV === 'production') {
  const bad = [];
  if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) bad.push('JWT_ACCESS_SECRET');
  if (env.JWT_REFRESH_SECRET.startsWith('dev-only')) bad.push('JWT_REFRESH_SECRET');
  if (env.OTP_DEV_ECHO === 'true') bad.push('OTP_DEV_ECHO must be false');
  if (bad.length) throw new Error(`Refusing to start in production: ${bad.join(', ')}`);
}

env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
env.otpEcho = !env.isProd && env.OTP_DEV_ECHO === 'true';
env.uploadDir = path.resolve(__dirname, '../..', env.UPLOAD_DIR);
module.exports = env;
