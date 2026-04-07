/**
 * pdf-extractor.ts
 * استخراج نص/صور من ملفات PDF
 * الاستراتيجية: نص (pdf-parse) أولاً — احتياطياً صور (pdftoppm) بجودة مخفضة
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
  | { mode: "vision"; images: string[] }
  | { mode: "text";   text: string };

/**
 * يستخرج محتوى PDF إما كنص أو كصور
 * الأولوية: نص (أسرع وأصغر) → صور إذا كان النص غير كافٍ
 */
export async function extractPdf(
  pdfPath: string,
  maxPages = 8
): Promise<PdfExtractionResult> {

  // ── محاولة 1: pdf-parse (نص — سريع، صغير، يعمل في كل مكان) ─────────────
  try {
    const buffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buffer);
    const text = parsed.text ?? "";
    if (text.trim().length >= 200) {
      console.log(`[pdf-extractor] وضع النص: ${text.length} حرف`);
      return { mode: "text", text };
    }
    console.log(`[pdf-extractor] النص غير كافٍ (${text.trim().length} حرف) → ننتقل للصور`);
  } catch (err) {
    console.warn("[pdf-extractor] pdf-parse فشل:", err);
  }

  // ── محاولة 2: pdftoppm بجودة مخفضة (للملفات الممسوحة ضوئياً) ────────────
  if (await commandExists("pdftoppm")) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taqeem-pdf-"));
    try {
      const outPrefix = path.join(tmpDir, "page");
      const pages = Math.min(maxPages, 5);   // أقصى 5 صفحات
      const dpi   = 96;                       // دقة مخفضة لتقليل حجم الصور
      await execAsync(
        `pdftoppm -r ${dpi} -png -l ${pages} "${pdfPath}" "${outPrefix}"`
      );

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .slice(0, pages);

      if (files.length > 0) {
        const images = files.map((f) =>
          fs.readFileSync(path.join(tmpDir, f)).toString("base64")
        );
        console.log(`[pdf-extractor] وضع الصور: ${images.length} صفحة بـ ${dpi}DPI`);
        return { mode: "vision", images };
      }
    } catch (err) {
      console.warn("[pdf-extractor] pdftoppm فشل:", err);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ── احتياطي أخير: نص فارغ ────────────────────────────────────────────────
  return { mode: "text", text: "" };
}
