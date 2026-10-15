import express from "express";
import nocache from "nocache";
import cors from "cors";
import dotenv from "dotenv";
import { createStream } from "rotating-file-stream";
dotenv.config();
import cookieParser from "cookie-parser";
import "./utils/googleAuthSetup.js";
import "./utils/facebookAuthSetup.js";
import morgan from "morgan";
import helmet from "helmet";
import connectDb from "./config/connectDb.js";
import userRouter from "./routes/user/user.route.js";
import path from "path";
import { fileURLToPath } from "url";
import adminRouter from "./routes/admin/admin.route.js";
import { errorHandler } from "./middlewares/Error/globalErrorHandler.js";
import passport from "passport";
import http from "http";
import qs from "qs";
import { SocketInit } from "./config/socketIo.js";
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
app.use(nocache());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

SocketInit(server);
app.set("query parser", (str) => qs.parse(str));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(passport.initialize());
app.use("/api/user", userRouter);
app.use("/api/admin", adminRouter);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const accessLogStream = createStream("access.log", {
  interval: "1d",
  path: path.join(__dirname, "log"),
});

app.use(morgan("combined", { stream: accessLogStream }));

const PORT = process.env.PORT;
app.get("/", (req, res) => {
  res.json({
    message: "server is running in" + process.env.PORT,
  });
});
app.use(errorHandler);
await connectDb();
server.listen(PORT, () => {
  console.log("server started at port", PORT);
});
