import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

// خدمة الواجهة المبنية (للتشغيل المحلي بدون Vite)
// __dirname = مجلد index.mjs المبني (artifacts/api-server/dist/)
// نصعد مستويين للوصول لـ artifacts/ ثم ننزل لـ taqeem-tool/dist/public
const fromBuildDir = path.resolve(__dirname, "../../taqeem-tool/dist/public");
// احتياطي: الطريقة القديمة (Replit dev mode حيث cwd = artifacts/api-server)
const fromCwd = path.resolve(process.cwd(), "../taqeem-tool/dist/public");
// احتياطي ثانٍ: تشغيل start.bat من مجلد المشروع الجذر
const fromRoot = path.resolve(process.cwd(), "artifacts/taqeem-tool/dist/public");

const frontendDist = [fromBuildDir, fromCwd, fromRoot].find(p => fs.existsSync(p)) ?? fromBuildDir;

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // إعادة توجيه كل المسارات غير الـ API إلى index.html (SPA)
  app.get(/^(?!\/api).*$/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
  logger.info({ frontendDist }, "يخدم الواجهة المبنية");
} else {
  logger.warn("مجلد الواجهة المبنية غير موجود — تشغيل API فقط");
}

export default app;
