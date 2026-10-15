import userModel from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import verifyMailTemplate from "../utils/verifyMailTemplete.js";
import generateAccessToken from "../utils/generateAccessToken.js";
import generateRefreshToken from "../utils/generateRefreshToken.js";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { getSignedImageUrl } from "../utils/getImageFromCloudinary.js";
import AppError from "../middlewares/Error/appError.js";
import { STATUS_CODES } from "../utils/statusCodes.js";
import productModel from "../models/product.model.js";
import { GoogleGenAI } from "@google/genai";
import sendEmail from "../config/emailService.js";
import OtpModel from "../models/otpModel.js";
import couponModel from "../models/coupon.model.js";
import categoryModel from "../models/category.model.js";
import { generateReferralCode } from "../utils/generateReferralCode.js";
const ai = new GoogleGenAI({ apiKey: process.env.AI_KEY });
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRETE_KEY,
  secure: true,
});

export const registerUserService = async ({ name, email, password, referralCode }) => {
  let user = await userModel.findOne({ email: email });
  if (user) {
    throw new AppError("User already exists with this email address", STATUS_CODES.CONFLICT);
  }
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user = new userModel({
    email: email,
    password: hashedPassword,
    name: name,
  });
  let referred;
  if (referralCode) {
    referred = await userModel.findOne({ referralCode });
  }
  if (referred) {
    const expiryDate = new Date().setDate(new Date().getDate() + 30);
    const code = await generateReferralCode(referred.name);
    await couponModel.create({
      code,
      description: "Referral Coupon offers 30% of offer for orders above Rs.100",
      discountType: "Percentage",
      discountValue: 30,
      allowedUsers: [referred._id],
      scope: "User",
      minPurchaseAmount: 300,
      expiryDate,
    });
  }
  await user.save();
  await OtpModel.create({
    userId: user._id,
    otp: otp,
    otp_expiry: Date.now() + 60000,
  });
  await sendEmail({
    to: email,
    subject: "Verification mail from shopping cart app",
    text: `Your OTP is ${otp}`,
    html: verifyMailTemplate(name, otp),
  });
  return user;
};

export const verifyEmailService = async ({ email, otp }) => {
  let user = await userModel.findOne({ email: email });
  if (!user) {
    throw new AppError("User not found", STATUS_CODES.NOT_FOUND);
  }
  let userOtp = await OtpModel.findOne({ userId: user._id });
  const isCodeValid = userOtp.otp == otp;
  const isNotExpired = userOtp.otp_expiry > new Date();
  if (!isCodeValid) {
    throw new AppError("Invalid OTP", STATUS_CODES.BAD_REQUEST);
  } else if (!isNotExpired) {
    throw new AppError("OTP expired", STATUS_CODES.BAD_REQUEST);
  }
  userOtp.isVerified = true;
  await userOtp.save();
  user.isVerified = true;
  await user.save();
  return true;
};
export const resendOtpService = async (email) => {
  const user = await userModel.findOne({ email: email });
  if (!user) {
    throw new AppError("User not found", STATUS_CODES.NOT_FOUND);
  }
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const userOtp = await OtpModel.findOne({ userId: user._id });
  if (userOtp) {
    userOtp.otp = otp;
    userOtp.otp_expiry = Date.now() + 60000;
    await userOtp.save();
  } else {
    await OtpModel.create({
      userId: user._id,
      otp: otp,
      otp_expiry: Date.now() + 60000,
    });
  }
  await sendEmail({
    to: email,
    subject: "Verification mail from shopping cart app",
    text: `Your OTP is ${otp}`,
    html: verifyMailTemplate(user.name, otp),
  });
};
export const userLoginService = async ({ email, password }) => {
  const user = await userModel.findOne({ email: email });

  if (!user) {
    throw new AppError("Invalid email address", STATUS_CODES.NOT_FOUND);
  }
  if (user.isBlocked) {
    throw new AppError("You are blocked, contact admin", STATUS_CODES.FORBIDDEN);
  }
  if (!user.isVerified) {
    throw new AppError("Please verify your email", STATUS_CODES.FORBIDDEN);
  }
  if (!user.password) {
    throw new AppError("No password ser for this email", STATUS_CODES.FORBIDDEN);
  }
  const checkPass = await bcrypt.compare(password, user.password);
  if (!checkPass) {
    throw new AppError("Incorrect password", STATUS_CODES.BAD_REQUEST);
  }
  const accessToken = await generateAccessToken(user._id, "User");
  const refreshToken = await generateRefreshToken(user._id, "User");
  await userModel.findByIdAndUpdate(user._id, {
    last_login_date: new Date(),
  });
  return { accessToken, refreshToken, user };
};
export const googleAuthService = async (user) => {
  const accessToken = await generateAccessToken(user._id, "User");
  const refreshToken = await generateRefreshToken(user._id, "User");
  return { accessToken, refreshToken };
};
export const forgotPasswordServices = async (email) => {
  const user = await userModel.findOne({ email: email });
  if (!user) {
    throw new AppError("User not found", STATUS_CODES.NOT_FOUND);
  }
  const userOtp = await OtpModel.findOne({ userId: user._id });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  if (userOtp) {
    userOtp.otp = otp;
    userOtp.otp_expiry = Date.now() + 60000;
    await userOtp.save();
  } else {
    await OtpModel.create({
      userId: user._id,
      otp: otp,
      otp_expiry: Date.now() + 60000,
    });
  }
  await user.save();
  await sendEmail({
    to: email,
    subject: "Verification mail from shopping cart app",
    text: `Your OTP is ${otp}`,
    html: verifyMailTemplate(user?.name, otp),
  });
};

export const resetPasswordService = async (email, newPassword, currentPassword) => {
  const user = await userModel.findOne({ email: email });
  const userOtp = await OtpModel.findOne({ userId: user._id });
  if (userOtp && !userOtp.isVerified) {
    throw new AppError("Please verify your mail");
  }
  if (!user.isVerified) {
    throw new AppError("Please verify your mail");
  }
  if (currentPassword) {
    const verify = await bcrypt.compare(currentPassword, user.password);
    if (!verify) {
      throw new AppError("Incorrect password", STATUS_CODES.BAD_REQUEST);
    }
  }
  if (user.password) {
    const isSameWithOld = await bcrypt.compare(newPassword, user.password);
    if (isSameWithOld) {
      throw new AppError("New Password is Same with Old Password");
    }
  }
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  user.password = hashedPassword;
  await user.save();
};

export const refreshTokenService = async (token) => {
  const verifyToken = await jwt.verify(token, process.env.JWT_REFRESH_KEY);
  if (!verifyToken) {
    throw new AppError("Token expired", STATUS_CODES.NOT_FOUND);
  }
  const userId = verifyToken?.id;
  const newAccessToken = await generateAccessToken(userId, "User");
  const refreshToken = await generateRefreshToken(userId, "User");

  return { newAccessToken, refreshToken };
};

export const authMeService = async (userId) => {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new AppError("Please Login, User not found", STATUS_CODES.NOT_FOUND);
  }
  let obj = user.toObject();
  if (user.googleId && user.image.includes("googleusercontent")) {
    obj.image = obj.image || null;
  } else if (user.facebookId && !user.image) {
    obj.image = `https://graph.facebook.com/${user.facebookId}/picture?type=large`;
  } else {
    obj.image = user.image ? getSignedImageUrl(user.image) : null;
  }
  if (obj.password) {
    obj.password = true;
  } else {
    obj.password = false;
  }
  return obj;
};
export const facebookAuthService = async (user) => {
  const accessToken = await generateAccessToken(user._id, "User");
  const refreshToken = await generateRefreshToken(user._id, "User");
  return { accessToken, refreshToken };
};

export const chatService = async (body, userId) => {
  const { query } = body;
  if (!query || typeof query !== "string") {
    return "Hello! How can I help you find the perfect product today?";
  }

  let contextData = "";

  if (userId) {
    const user = await userModel.findById(userId).select("name email");
    if (user) {
      contextData += `Customer Name: ${user.name}. `;
    }
  }

  // 1. Natural language intent analysis & keyword extraction
  const wantsTopRated = /better|best|top|highest|rated|quality|premium|recommend|suggest|favorite|popular/i.test(query);
  const wantsBudget = /cheap|affordable|budget|low price|inexpensive|deal|discount|sale|offer/i.test(query);

  const stopWords = new Set([
    "a", "an", "the", "in", "on", "at", "for", "to", "of", "with", "by", "from",
    "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "better", "best", "good", "great", "nice", "top", "cheap", "expensive",
    "show", "me", "looking", "find", "get", "suggest", "recommend", "give", "tell",
    "any", "some", "product", "products", "item", "items", "store", "buy", "shop",
    "please", "help", "need", "want", "like", "how", "much"
  ]);

  const cleanQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const keywords = tokens.filter((w) => !stopWords.has(w) && w.length >= 2);

  // 2. Query products using multiple strategies
  let products = [];
  const baseFilter = { isUnlisted: { $ne: true } };

  // Check matching categories by keywords
  let matchingCategoryIds = [];
  if (keywords.length > 0) {
    const categoryMatches = await categoryModel.find({
      name: { $in: keywords.map((kw) => new RegExp(kw, "i")) },
      isBlocked: false,
    }).select("_id");
    matchingCategoryIds = categoryMatches.map((c) => c._id);
  }

  // Strategy A: Search with extracted keywords across fields & categories
  if (keywords.length > 0) {
    const orConditions = [
      ...keywords.map((kw) => ({ name: { $regex: kw, $options: "i" } })),
      ...keywords.map((kw) => ({ tags: { $in: [new RegExp(kw, "i")] } })),
      ...keywords.map((kw) => ({ brand: { $regex: kw, $options: "i" } })),
      ...keywords.map((kw) => ({ description: { $regex: kw, $options: "i" } })),
    ];

    if (matchingCategoryIds.length > 0) {
      orConditions.push(
        { categoryId: { $in: matchingCategoryIds } },
        { subCategoryId: { $in: matchingCategoryIds } },
        { thirdSubCategoryId: { $in: matchingCategoryIds } }
      );
    }

    let sortOption = { rating: -1, dateCreated: -1 };
    if (wantsBudget) {
      sortOption = { discount: -1, dateCreated: -1 };
    } else if (wantsTopRated) {
      sortOption = { rating: -1, reviewCount: -1 };
    }

    products = await productModel
      .find({
        ...baseFilter,
        $or: orConditions,
      })
      .populate("variants")
      .sort(sortOption)
      .limit(6);
  }

  // Strategy B: If no keyword results, try full query regex on name
  if (products.length === 0) {
    products = await productModel
      .find({
        ...baseFilter,
        name: { $regex: query.trim(), $options: "i" },
      })
      .populate("variants")
      .limit(5);
  }

  // Strategy C: If still 0 products, get top-rated / featured products so AI can offer alternatives
  let isFallback = false;
  if (products.length === 0) {
    isFallback = true;
    products = await productModel
      .find(baseFilter)
      .populate("variants")
      .sort({ rating: -1, isFeatured: -1 })
      .limit(5);
  }

  if (products.length > 0) {
    const productDetails = products.map((p) => {
      const activeVariant = p.variants?.find((v) => !v.isUnlisted) || p.variants?.[0];
      const price = activeVariant?.price ? `₹${activeVariant.price}` : "Price on catalog";
      const rating = p.rating ? `${p.rating}/5` : "4.5/5";
      const brand = p.brand ? `by ${p.brand}` : "";
      const discount = p.discount ? ` (${p.discount}% OFF)` : "";
      return `- **${p.name}** ${brand} | Price: ${price}${discount} | Rating: ★ ${rating}\n  Description: ${p.description?.slice(0, 120) || "Top quality product"}`;
    }).join("\n");

    if (isFallback) {
      contextData += `Note: No direct matches found for "${query}". Here are our store's top-rated popular products to recommend instead:\n${productDetails}\n`;
    } else {
      contextData += `Available matching products in our store:\n${productDetails}\n`;
    }
  } else {
    contextData += "No products currently available in inventory.";
  }

  const aiPrompt = `
You are the personal AI Shopping Stylist and Assistant for "Gratia", a modern online fashion and lifestyle store.
Your goal is to help shoppers find great products, recommend the best matches, and provide a delightful shopping experience.

Customer Context:
${contextData}

Customer Inquiry:
"${query}"

Guidelines for your response:
1. Recommend 2 to 3 relevant products directly from the provided catalog context whenever available.
2. For each recommendation, highlight the product name in **bold**, state its price in ₹, mention its rating, and give a brief 1-sentence reason why it's a great choice.
3. If the user asks for a "better" or "best" product (e.g. "better shirt"), understand they want high quality, top-rated, or stylish options. Recommend our highest-rated items enthusiastically.
4. Keep the response friendly, concise, stylish, and engaging.
5. NEVER respond with a cold list of interrogation questions. If needed, suggest products first, then end with one natural, helpful follow-up question (e.g., "Would you like to see casual styles or formal options?").
6. Always format using clean markdown: use **bold** for names, bullet points for lists, and clean paragraph breaks.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: aiPrompt,
    });

    return response.text || "I'm here to help! Could you tell me more about what style or product you're looking for?";
  } catch (err) {
    console.error("Gemini API error in chatService:", err);
    return "I am currently having a moment, but I'd love to help you browse our latest collections! Please check our fashion and footwear categories or try asking again.";
  }
};

export const userImageUploadService = async (userId, image) => {
  const user = await userModel.findOne({ _id: userId });
  if (!user) throw new AppError("User not found", STATUS_CODES.NOT_FOUND);
  const imgUrl = user.image;
  if (imgUrl) {
    const imageName = imgUrl.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(imageName, { type: "authenticated" });
  }

  const options = {
    folder: "users",
    type: "authenticated",
    use_filename: true,
    unique_filename: false,
    overwrite: false,
  };
  const result = await cloudinary.uploader.upload(image.path, options);
  fs.unlinkSync(`uploads/${image.filename}`);

  user.image = result.public_id;

  await user.save();
  return { _id: userId, image: user.image };
};

export const editUserService = async (userId, body) => {
  const { name, email, mobile } = body;
  const updated = await userModel.findByIdAndUpdate(userId, { name, email, mobile });
  return updated;
};

export const emailChangeOtpService = async (userId, email) => {
  const isExist = await userModel.findOne({ email });
  if (isExist) {
    throw new AppError("User already exist in this email address", STATUS_CODES.NOT_FOUND);
  }
  const user = await userModel.findById(userId);
  const userOtp = await OtpModel.findOne({ userId });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  if (userOtp) {
    userOtp.otp = otp;
    userOtp.otp_expiry = Date.now() + 60000;
    await userOtp.save();
  } else {
    await OtpModel.create({
      userId: user._id,
      otp: otp,
      otp_expiry: Date.now() + 60000,
    });
  }
  await sendEmail({
    to: email,
    subject: "Verification mail from shopping cart app",
    text: `Your OTP is ${otp}`,
    html: verifyMailTemplate(user?.name, otp),
  });
};

export const emailChangeResendOtpService = async (email, userId) => {
  const user = await userModel.findById(userId);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const userOtp = await OtpModel.findOne({ userId });
  if (userOtp) {
    userOtp.otp = otp;
    userOtp.otp_expiry = Date.now() + 60000;
    await userOtp.save();
  } else {
    await OtpModel.create({
      userId: user._id,
      otp: otp,
      otp_expiry: Date.now() + 60000,
    });
  }
  await sendEmail({
    to: email,
    subject: "Verification mail from shopping cart app",
    text: `Your OTP is ${otp}`,
    html: verifyMailTemplate(user.name, otp),
  });
};

export const emailChangeVerifyService = async (userId, otp) => {
  let userOtp = await OtpModel.findOne({ userId });
  const isCodeValid = userOtp.otp == otp;
  const isNotExpired = userOtp.otp_expiry > new Date();
  if (!isCodeValid) {
    throw new AppError("Invalid OTP", STATUS_CODES.BAD_REQUEST);
  } else if (!isNotExpired) {
    throw new AppError("OTP expired", STATUS_CODES.BAD_REQUEST);
  }
  return true;
};

export const getUserChartDataService = async (query) => {
  const { type = "daily", startDate, endDate, year, month } = query;
  const now = new Date();
  const firstDayOfWeek = new Date(now);
  let start, end;
  let day = (now.getDay() + 6) % 7;
  firstDayOfWeek.setDate(now.getDate() - day);
  
  const lastDayOfTheWeek = new Date(firstDayOfWeek);
  lastDayOfTheWeek.setDate(firstDayOfWeek.getDate() + 6);
  switch (type) {
    case "daily":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    case "weekly":
      start = firstDayOfWeek;
      end = lastDayOfTheWeek;
      break;
    case "monthly":
      start = new Date(year, month - 1, 1);
      end = new Date(year, month, 0);
      break;
    case "yearly":
      start = new Date(year, 0, 1);
      end = new Date(year + 1, 0, 1);
      break;
    case "custom":
      start = new Date(startDate);
      end = new Date(endDate);
      break;
  }
  const data = await userModel.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id:
          type === "yearly"
            ? { $month: "$createdAt" }
            : { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        total: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const map = new Map(data.map((i) => [i._id, i.total]));
  const filled = [];
  if (type === "yearly") {
    for (let m = 1; m <= 12; m++) {
      filled.push({
        name: new Date(2025, m - 1, 1).toLocaleString("default", {
          month: "short",
        }),
        users: map.get(m) || 0,
      });
    }
  } else if (type === "daily") {
    const key = new Date().toISOString().slice(0, 10);
    filled.push({
      name: `${new Date().getDate()} ${new Date().toLocaleString("default", {
        month: "short",
      })}`,
      users: map.get(key) || 0,
    });
  } else {
    const current = new Date(start);
    while (current <= end) {
      const key = current.toISOString().slice(0, 10);
      filled.push({
        name: `${current.getDate()} ${current.toLocaleString("default", {
          month: "short",
        })}`,
        users: map.get(key) || 0,
      });
      current.setDate(current.getDate() + 1);
    }
  }
  console.log(filled);
  return filled;
};
