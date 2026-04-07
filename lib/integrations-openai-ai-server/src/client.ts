import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (!baseURL) {
      throw new Error(
        "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to add your OpenAI key to openai-key.txt?",
      );
    }
    if (!apiKey) {
      throw new Error(
        "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to add your OpenAI key to openai-key.txt?",
      );
    }

    _client = new OpenAI({ apiKey, baseURL });
  }
  return _client;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getClient() as Record<string | symbol, unknown>)[prop];
  },
});
