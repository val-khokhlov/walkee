import { activeKey, loadAiConfig, type AiConfig, type AiProvider } from './aiConfig';
import { createRpmGate, fetchWithTimeout, isAbortError, sleepMs } from './http';

export type LlmErrorKind = 'no_key' | 'auth' | 'model' | 'quota_daily' | 'rate' | 'other';

export class LlmError extends Error {
  kind: LlmErrorKind;
  status: number;
  constructor(message: string, kind: LlmErrorKind, status = 0) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}

const PROVIDER_NAME: Record<AiProvider, string> = { gemini: 'Gemini', groq: 'Groq' };
const ONE_HOUR_MS = 60 * 60 * 1000;

const acquireSlot = createRpmGate(() => loadAiConfig().maxRpm);
/** After a daily-quota error, stop sending requests so the rest of the route does not hammer a closed door. */
const blockedUntil: Record<AiProvider, number> = { gemini: 0, groq: 0 };

interface GenOpts {
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

function classify(status: number, body: string): LlmErrorKind {
  const b = body.toLowerCase();
  if (status === 401 || status === 403 || b.includes('api_key_invalid') || b.includes('api key not valid') || b.includes('invalid api key')) {
    return 'auth';
  }
  if (status === 404 || b.includes('model_not_found') || b.includes('no longer available') || b.includes('does not exist')) {
    return 'model';
  }
  if (status === 429 || b.includes('resource_exhausted')) {
    return /perday|per day|\brpd\b|\btpd\b|daily|limit:\s*0\b/i.test(body) ? 'quota_daily' : 'rate';
  }
  return 'other';
}

function retryDelaySec(body: string, headers: Headers): number {
  const h = Number(headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return Math.min(h, 90);
  const m = body.match(/retry in ([\d.]+)s/i) || body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return Math.min(Number(m?.[1]) || 20, 90);
}

function friendlyMessage(kind: LlmErrorKind, provider: AiProvider, status: number, body: string): string {
  const name = PROVIDER_NAME[provider];
  switch (kind) {
    case 'auth':
      return `${name} rejected the API key. Check it in Settings.`;
    case 'model':
      return `${name} says this model is not available to your key. Pick another model in Settings; Test connection lists the ones you can use.`;
    case 'quota_daily':
      return `${name} daily quota reached. Try again tomorrow or switch provider in Settings.`;
    case 'rate':
      return `${name} rate limit reached. Lower "Requests per minute" in Settings.`;
    default:
      return `${name} error ${status}: ${body.replace(/\s+/g, ' ').slice(0, 220)}`;
  }
}

/* ---------- Gemini ---------- */

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

function geminiRequest(cfg: AiConfig, prompt: string, o: GenOpts): Promise<Response> {
  const model = cfg.geminiModel.trim().replace(/^models\//, '');
  return fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey.trim() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: o.temperature, maxOutputTokens: o.maxOutputTokens },
      }),
      timeoutMs: 120_000,
      signal: o.signal,
    }
  );
}

function extractGemini(j: GeminiResponse): string {
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) {
    const why = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || 'unknown reason';
    throw new LlmError(`Gemini returned no text (${why}).`, 'other');
  }
  return text;
}

/* ---------- Groq (OpenAI-compatible) ---------- */

interface GroqResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

function groqRequest(cfg: AiConfig, prompt: string, o: GenOpts): Promise<Response> {
  return fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.groqKey.trim()}` },
    body: JSON.stringify({
      model: cfg.groqModel.trim(),
      messages: [{ role: 'user', content: prompt }],
      temperature: o.temperature,
      max_completion_tokens: o.maxOutputTokens,
    }),
    timeoutMs: 120_000,
    signal: o.signal,
  });
}

function extractGroq(j: GroqResponse): string {
  const text = j.choices?.[0]?.message?.content || '';
  if (!text) throw new LlmError('Groq returned no text.', 'other');
  return text;
}

/* ---------- public API ---------- */

/** One text generation with the user's own key. Retries per-minute limits, stops on daily quota. */
export async function generateText(prompt: string, opts: GenOpts = {}): Promise<string> {
  const cfg = loadAiConfig();
  const provider = cfg.provider;
  if (!activeKey(cfg)) throw new LlmError('Add your Gemini or Groq API key in Settings.', 'no_key');
  if (Date.now() < blockedUntil[provider]) {
    throw new LlmError(friendlyMessage('quota_daily', provider, 429, ''), 'quota_daily', 429);
  }
  const o: GenOpts = { temperature: 0.3, maxOutputTokens: 4096, ...opts };

  for (let attempt = 0; ; attempt++) {
    await acquireSlot();

    let res: Response;
    try {
      res = await (provider === 'gemini' ? geminiRequest(cfg, prompt, o) : groqRequest(cfg, prompt, o));
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (attempt < 2) {
        await sleepMs(2000 * (attempt + 1));
        continue;
      }
      throw new LlmError(`${PROVIDER_NAME[provider]} request failed: ${e instanceof Error ? e.message : String(e)}`, 'other');
    }

    if (res.ok) {
      const json: unknown = await res.json();
      return provider === 'gemini' ? extractGemini(json as GeminiResponse) : extractGroq(json as GroqResponse);
    }

    const body = await res.text().catch(() => '');
    const kind = classify(res.status, body);
    if (kind === 'rate' && attempt < 3) {
      await sleepMs(retryDelaySec(body, res.headers) * 1000 + 500);
      continue;
    }
    if (kind === 'other' && res.status >= 500 && attempt < 2) {
      await sleepMs(1500 * 2 ** attempt);
      continue;
    }
    if (kind === 'quota_daily') blockedUntil[provider] = Date.now() + ONE_HOUR_MS;
    throw new LlmError(friendlyMessage(kind, provider, res.status, body), kind, res.status);
  }
}

/** Lists the text models this key can use (for the Settings model picker and "Test connection"). */
export async function listModels(provider: AiProvider, key: string, signal?: AbortSignal): Promise<string[]> {
  const k = key.trim();
  if (!k) throw new LlmError('Enter an API key first.', 'no_key');

  const res =
    provider === 'gemini'
      ? await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
          headers: { 'x-goog-api-key': k },
          signal,
        })
      : await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${k}` },
          signal,
        });
  const body = await res.text();
  if (!res.ok) {
    const kind = classify(res.status, body);
    throw new LlmError(friendlyMessage(kind, provider, res.status, body), kind, res.status);
  }

  if (provider === 'gemini') {
    const j = JSON.parse(body) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => !/tts|embed|imagen|veo|image|live|audio|robotics/i.test(id))
      .sort();
  }
  const j = JSON.parse(body) as { data?: Array<{ id: string }> };
  return (j.data || [])
    .map((m) => m.id)
    .filter((id) => !/whisper|tts|orpheus|guard|playai/i.test(id))
    .sort();
}
