export type AiProvider = 'gemini' | 'groq';

export interface AiConfig {
  provider: AiProvider;
  geminiKey: string;
  groqKey: string;
  geminiModel: string;
  groqModel: string;
  /** Your own free-tier limit; the app never sends more requests per minute than this. */
  maxRpm: number;
  /** Cap on buildings researched per route, so one walk cannot burn the whole daily quota. */
  maxBuildings: number;
  /** Comma-separated Wikipedia language codes searched for each building. */
  wikiLangs: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'gemini',
  geminiKey: '',
  groqKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
  groqModel: 'openai/gpt-oss-120b',
  maxRpm: 8,
  maxBuildings: 40,
  wikiLangs: 'en,uk',
};

// Keys live in this device's local storage only. Moving them to the iOS Keychain /
// Android Keystore (a secure-storage plugin) is a later hardening step.
const STORAGE_KEY = 'wanderaudio_ai_v1';

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
};

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    const p = JSON.parse(raw) as Partial<AiConfig>;
    return {
      ...DEFAULT_AI_CONFIG,
      ...p,
      provider: p.provider === 'groq' ? 'groq' : 'gemini',
      maxRpm: clamp(p.maxRpm, 1, 120, DEFAULT_AI_CONFIG.maxRpm),
      maxBuildings: clamp(p.maxBuildings, 1, 250, DEFAULT_AI_CONFIG.maxBuildings),
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function saveAiConfig(partial: Partial<AiConfig>): AiConfig {
  const next = { ...loadAiConfig(), ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked or full */
  }
  return next;
}

export const activeKey = (c: AiConfig): string => (c.provider === 'groq' ? c.groqKey : c.geminiKey).trim();

export const hasAiKey = (): boolean => activeKey(loadAiConfig()).length > 0;
