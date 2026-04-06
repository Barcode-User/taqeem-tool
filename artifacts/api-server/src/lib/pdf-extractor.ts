/**
 * pdf-extractor.ts
 * استخراج نص/صور من ملفات PDF لتمريرها لـ OpenAI
 * - يستخدم pdftoppm لتحويل الصفحات لصور (Linux/Replit)
 * - يرجع للنص العادي بـ pdf-parse إذا لم يتوفر pdftoppm (Windows)
 */

import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import pdfParse from "pdf-parse";

const execAsync = promisify(exec);

/** يتحقق من وجود أمر نظام معين */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

/** نتيجة الاستخراج */
export type PdfExtractionResult =
  | { mode: "vision"; images: string[] }      // base64 PNGs
  | { mode: "text";   text: string };

/**
 * يستخرج محتوى PDF إما كصور (vision) أو كنص خام
 * @param pdfPath المسار الكامل لملف PDF
 * @param maxPages أقصى عدد صفحات للمعالجة (افتراضي 8)
 */
export async function extractPdf(
  pdfPath: string,
  maxPages = 8
): Promise<PdfExtractionResult> {
  // ── محاولة 1: pdftoppm (متاح على Linux/Replit) ──────────────────────────
  if (await commandExists("pdftoppm")) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taqeem-pdf-"));
    try {
      const outPrefix = path.join(tmpDir, "page");
      await execAsync(
        `pdftoppm -r 150 -png -l ${maxPages} "${pdfPath}" "${outPrefix}"`
      );

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .slice(0, maxPages);

      if (files.length > 0) {
        const images = files.map((f) =>
          fs.readFileSync(path.join(tmpDir, f)).toString("base64")
        );
        return { mode: "vision", images };
      }
    } catch (err) {
      // pdftoppm فشل — سنرجع للنص
      console.warn("[pdf-extractor] pdftoppm failed, falling back to text:", err);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ── محاولة 2: pdf-parse (نص خام، يعمل على Windows بدون أدوات إضافية) ──
  const buffer = fs.readFileSync(pdfPath);
  const parsed = await pdfParse(buffer);
  return { mode: "text", text: parsed.text ?? "" };
}
