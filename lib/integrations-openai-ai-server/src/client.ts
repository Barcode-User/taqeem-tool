import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    // الأولوية: GEMINI_API_KEY (مجاني) ← AI_INTEGRATIONS (Replit/OpenAI)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      _client = new OpenAI({
        apiKey: geminiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
      return _client;
    }

    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (!baseURL || !apiKey) {
      throw new Error(
        "لم يتم تعيين مفتاح AI. أنشئ gemini-key.txt (مجاني) أو openai-key.txt بجانب start.bat",
      );
    }

    _client = new OpenAI({ apiKey, baseURL });
  }
  return _client;
}

/** يعيد اسم النموذج المناسب للخدمة المُهيَّأة */
export function getAIModel(): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (process.env.GEMINI_API_KEY) return "gemini-2.0-flash";
  return "gpt-4.1";
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
