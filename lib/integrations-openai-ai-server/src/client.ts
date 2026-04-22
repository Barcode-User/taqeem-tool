import OpenAI from "openai";

let _client: OpenAI | null = null;
let _provider: "integration" | "groq" | "gemini" = "integration";

function getClient(): OpenAI {
  if (!_client) {
    // الأولوية:
    // 1. AI_INTEGRATIONS — Replit proxy أو مفتاح OpenAI من openai-key.txt (Windows)
    // 2. GROQ — إذا لم يكن هناك AI_INTEGRATIONS (إعداد يدوي بـ groq-key.txt فقط)
    // 3. Gemini — آخر خيار

    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (baseURL && apiKey) {
      console.log("[AI] ✅ يستخدم OpenAI / Replit Integration");
      _provider = "integration";
      _client = new OpenAI({ apiKey, baseURL });
      return _client;
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      console.log("[AI] 🟢 يستخدم Groq (مجاني — groq-key.txt / GROQ_API_KEY)");
      _provider = "groq";
      _client = new OpenAI({
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
      return _client;
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      console.log("[AI] 🟡 يستخدم Gemini (GEMINI_API_KEY)");
      _provider = "gemini";
      _client = new OpenAI({
        apiKey: geminiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
      return _client;
    }

    throw new Error(
      "لم يتم تعيين مفتاح AI. أنشئ groq-key.txt (مجاني) بجانب start.bat",
    );
  }
  return _client;
}

/** يعيد اسم النموذج المناسب للخدمة المُهيَّأة */
export function getAIModel(): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  // نطابق الأولوية في getClient()
  if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return "gpt-4o-mini";
  }
  if (process.env.GROQ_API_KEY)   return "llama-3.3-70b-versatile";
  if (process.env.GEMINI_API_KEY) return "gemini-2.0-flash";
  return "gpt-4o-mini";
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
