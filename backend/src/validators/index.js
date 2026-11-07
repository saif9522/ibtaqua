const { z } = require('zod');

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');
const email = z.string().trim().toLowerCase().email('Enter a valid email');
const password = z.string().min(8, 'Use at least 8 characters').max(72).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number');
const gstin = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN');
const pincode = z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.coerce.number().int().positive();
const paise = z.coerce.number().int().min(0);
const tier = z.enum(['customer', 'retailer', 'wholesaler', 'distributor']);
const opt = (s) => s.optional().or(z.literal('').transform(() => undefined));

const auth = {
  otpRequest: z.object({ phone, purpose: z.enum(['login', 'register', 'reset']).default('login') }),
  otpVerify: z.object({ phone, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit OTP'), name: opt(z.string().trim().min(2).max(120)), email: opt(email), password: opt(password) }),
  passwordReset: z.object({ phone, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit OTP'), password }),
  login: z.object({ identifier: z.string().trim().min(3), password: z.string().min(1) }),
  business: z.object({
    businessName: z.string().trim().min(2).max(160), contactPerson: z.string().trim().min(2).max(120), phone, email: opt(email), password,
    gstin: opt(gstin), pan: opt(pan), address: z.string().trim().min(5).max(300), city: z.string().trim().min(2), state: z.string().trim().min(2), pincode,
  }),
  refresh: z.object({ refreshToken: z.string().min(20) }),
};

const address = z.object({
  label: z.string().trim().max(40).default('Home'), contactName: z.string().trim().min(2).max(120), contactPhone: phone,
  line1: z.string().trim().min(3).max(200), line2: opt(z.string().trim().max(200)), landmark: opt(z.string().trim().max(120)),
  city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80), pincode,
  lat: z.coerce.number().min(-90).max(90).optional().nullable(), lng: z.coerce.number().min(-180).max(180).optional().nullable(),
  isDefault: z.boolean().optional(),
});

const cartItems = z.array(z.object({ productId: id, quantity: z.coerce.number().int().min(1).max(100000) })).min(1).max(50);
const paymentMethod = z.enum(['razorpay', 'upi', 'cod', 'bank_transfer', 'credit']);

const checkout = {
  quote: z.object({ items: cartItems, addressId: id.optional(), couponCode: opt(z.string().trim().max(40)), paymentMethod: paymentMethod.optional() }),
  place: z.object({
    items: cartItems, addressId: id, couponCode: opt(z.string().trim().max(40)), paymentMethod,
    deliveryDate: opt(isoDate), deliverySlot: opt(z.string().max(40)), notes: opt(z.string().max(500)), source: z.enum(['web', 'mobile']).default('web'),
  }),
};

const product = z.object({
  categoryId: id, name: z.string().trim().min(2).max(160), sku: z.string().trim().toUpperCase().min(2).max(60),
  description: opt(z.string().max(5000)), sizeMl: z.coerce.number().int().positive(), unitType: z.enum(['bottle', 'case', 'jar', 'bulk']),
  unitsPerPack: z.coerce.number().int().positive().default(1), mrp: paise, gstPercent: z.coerce.number().min(0).max(28),
  hsnCode: opt(z.string().max(12)), packagingInfo: opt(z.string().max(300)), isReturnableJar: z.coerce.boolean().default(false),
  status: z.enum(['active', 'inactive', 'out_of_stock']).default('active'), isFeatured: z.coerce.boolean().default(false),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  prices: z.array(z.object({ tier, price: paise, minOrderQty: z.coerce.number().int().min(1).default(1), discountPercent: z.coerce.number().min(0).max(100).default(0) })).optional(),
});

const price = z.object({
  productId: id, tier, price: paise, minOrderQty: z.coerce.number().int().min(1).default(1), discountPercent: z.coerce.number().min(0).max(100).default(0),
  zoneId: id.optional().nullable(), userId: id.optional().nullable(), validFrom: opt(isoDate).nullable(), validTo: opt(isoDate).nullable(), isActive: z.boolean().default(true),
});

module.exports = { z, phone, email, password, gstin, pan, pincode, isoDate, id, paise, tier, opt, auth, address, checkout, product, price, cartItems, paymentMethod };
