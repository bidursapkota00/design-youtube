export const khaltiConfig = {
  // Use sandbox for development, production for live
  baseUrl: process.env.KHALTI_BASE_URL || "https://dev.khalti.com/api/v2",
  secretKey: process.env.KHALTI_SECRET_KEY || "",
  returnUrl:
    process.env.KHALTI_RETURN_URL ||
    "http://localhost:3000/payment/callback",
  websiteUrl: process.env.WEBSITE_URL || "http://localhost:3000",
};
