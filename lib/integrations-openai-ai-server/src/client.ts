import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    // الأولوية: GROQ ← Gemini ← AI_INTEGRATIONS (OpenAI/Replit)

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      console.log("[AI] 🟢 يستخدم Groq (مجاني — groq-key.txt / GROQ_API_KEY)");
      _client = new OpenAI({
        apiKey: groqKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
      return _client;
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      console.log("[AI] 🟡 يستخدم Gemini (GEMINI_API_KEY)");
      _client = new OpenAI({
        apiKey: geminiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
      return _client;
    }

    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    console.log("[AI] 🔴 يستخدم OpenAI / Replit Integration");

    if (!baseURL || !apiKey) {
      throw new Error(
        "لم يتم تعيين مفتاح AI. أنشئ groq-key.txt (مجاني) بجانب start.bat",
      );
    }

    _client = new OpenAI({ apiKey, baseURL });
  }
  return _client;
}

/** يعيد اسم النموذج المناسب للخدمة المُهيَّأة */
export function getAIModel(): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (process.env.GROQ_API_KEY)   return "llama-3.3-70b-versatile";
  if (process.env.GEMINI_API_KEY) return "gemini-2.0-flash";
  return "gpt-4.1";
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
