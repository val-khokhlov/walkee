import { CATEGORY_MAP } from '../constants/categories';
import type { CategoryFinding, CategoryId, DiscoveredBuilding, GroundingSource } from '../types/tour';
import { loadAiConfig } from './aiConfig';
import { fetchWithTimeout, isAbortError } from './http';
import { generateText } from './llm';

const GUIDANCE: Record<CategoryId, string> = {
  historical: 'Target 800-1000 words if notable. Cover founding era, historical milestones, transformations, and civic importance.',
  famous_people: 'Target 600-800 words if notable. Identify the person(s), their life/achievements, and their concrete connection to this exact address.',
  architecture: 'Target 600-800 words if notable. Detail architectural style/school, facade/structural elements, architect, construction year, and interesting facts.',
  cultural: 'Target 600-800 words if notable. Detail books, films, music, artistic movements, or cultural gatherings tied to this building.',
  folklore: 'Target 500-700 words if notable. Share verified dramatic episodes, scandals, mysteries, or enduring local lore.',
};

/** Findings produced this session, so re-running a route does not repeat model calls. */
const sessionCache = new Map<string, CategoryFinding>();

function cleanForSpeech(s: string): string {
  return s
    .replace(/\*\*?|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- Wikipedia sources ---------- */

interface WikiArticle {
  title: string;
  url: string;
  extract: string;
}

type ExtractResponse = {
  query?: { pages?: Record<string, { title?: string; fullurl?: string; extract?: string; missing?: string }> };
};

async function wikiGet<T>(lang: string, params: Record<string, string>, signal?: AbortSignal): Promise<T | null> {
  try {
    const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    for (const [k, v] of Object.entries({ format: 'json', origin: '*', ...params })) u.searchParams.set(k, v);
    const r = await fetchWithTimeout(u.toString(), { timeoutMs: 8000, signal });
    return r.ok ? ((await r.json()) as T) : null;
  } catch (e) {
    if (isAbortError(e)) throw e;
    return null;
  }
}

async function wikiExtract(
  lang: string,
  by: { pageid?: number; title?: string },
  signal?: AbortSignal
): Promise<WikiArticle | null> {
  const j = await wikiGet<ExtractResponse>(
    lang,
    {
      action: 'query',
      prop: 'extracts|info',
      inprop: 'url',
      explaintext: '1',
      redirects: '1',
      ...(by.pageid ? { pageids: String(by.pageid) } : { titles: by.title || '' }),
    },
    signal
  );
  const page = Object.values(j?.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.extract || page.extract.length < 200) return null;
  const title = page.title || by.title || '';
  return {
    title,
    url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    extract: page.extract,
  };
}

async function wikiNearby(lang: string, lat: number, lng: number, signal?: AbortSignal): Promise<WikiArticle[]> {
  const g = await wikiGet<{ query?: { geosearch?: Array<{ pageid: number }> } }>(
    lang,
    { action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: '60', gslimit: '3' },
    signal
  );
  const out: WikiArticle[] = [];
  for (const hit of (g?.query?.geosearch || []).slice(0, 2)) {
    const a = await wikiExtract(lang, { pageid: hit.pageid }, signal);
    if (a) out.push(a);
  }
  return out;
}

function wikiLanguages(): string[] {
  const langs = loadAiConfig()
    .wikiLangs.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,3}(-[a-z]+)?$/.test(s));
  return [...new Set(langs.length ? langs : ['en'])].slice(0, 3);
}

/** Articles about this exact building: the OSM `wikipedia` tag first, then Wikipedia articles geotagged within 60 m. */
async function gatherArticles(building: DiscoveredBuilding, signal?: AbortSignal): Promise<WikiArticle[]> {
  const tagged = building.osmFacts?.match(/^wikipedia:\s*([a-z-]{2,8}):(.+)$/m);
  const tasks: Array<Promise<WikiArticle[]>> = [];
  if (tagged) {
    tasks.push(wikiExtract(tagged[1], { title: tagged[2].trim() }, signal).then((a) => (a ? [a] : [])));
  }
  for (const lang of wikiLanguages()) {
    tasks.push(wikiNearby(lang, building.location.lat, building.location.lng, signal));
  }
  const seen = new Set<string>();
  return (await Promise.all(tasks))
    .flat()
    .filter((a) => !seen.has(a.url) && seen.add(a.url))
    .slice(0, 4);
}

/* ---------- writing ---------- */

export interface ResearchResult {
  findings: CategoryFinding[];
  rawAiResponse: string;
}

export async function researchBuilding(
  building: DiscoveredBuilding,
  categories: CategoryId[],
  opts: { guideLanguage?: string; signal?: AbortSignal } = {}
): Promise<ResearchResult> {
  const cfg = loadAiConfig();
  const label = building.displayName ? `${building.streetAddress} (${building.displayName})` : building.streetAddress;
  const language = opts.guideLanguage || 'English';
  const providerLabel = cfg.provider === 'groq' ? 'Groq' : 'Gemini';

  const queryFor = (catId: CategoryId) => CATEGORY_MAP[catId].queryTemplate.replace('{ADDRESS}', label);
  const mk = (
    catId: CategoryId, isNotable: boolean, headline: string, summary: string, wordCount: number, sources: GroundingSource[]
  ): CategoryFinding => ({
    categoryId: catId,
    queryUsed: queryFor(catId),
    isNotable,
    headline,
    summary,
    wordCount,
    sources: isNotable ? sources : [],
    googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(queryFor(catId))}`,
    searchProvider: `Wikipedia + OSM sources, written by ${providerLabel}`,
  });
  const cacheKey = (catId: CategoryId) => `${building.normalizedAddress}|${catId}|${language}`;

  const done = new Map<CategoryId, CategoryFinding>();
  const todo: CategoryId[] = [];
  for (const c of categories) {
    const hit = sessionCache.get(cacheKey(c));
    if (hit) done.set(c, hit);
    else todo.push(c);
  }
  const ordered = () => categories.map((c) => done.get(c) as CategoryFinding);
  if (todo.length === 0) return { findings: ordered(), rawAiResponse: 'Served from this session\'s cache.' };

  const articles = await gatherArticles(building, opts.signal);
  const hasFacts = Boolean(building.osmFacts && /architect|start_date|heritage|wikipedia|wikidata|description/.test(building.osmFacts));
  if (articles.length === 0 && !hasFacts) {
    // Nothing verifiable exists, so no model call: it could only invent details.
    for (const c of todo) {
      done.set(c, mk(c, false, 'No notable match found', 'No Wikipedia, Wikidata or OSM heritage data was found for this address.', 0, []));
    }
    return { findings: ordered(), rawAiResponse: 'No sources found; no model call made.' };
  }

  // Keep the prompt small: free tiers limit tokens per minute as well as requests.
  let remaining = cfg.provider === 'groq' ? 9000 : 18000;
  const blocks: string[] = [];
  const used: GroundingSource[] = [];
  if (building.osmFacts) blocks.push(`OSM TAGS:\n${building.osmFacts}`);
  articles.forEach((a, i) => {
    if (remaining < 500) return;
    const text = a.extract.slice(0, Math.min(6000, remaining));
    remaining -= text.length;
    blocks.push(`SOURCE ${i + 1} (${a.title}, ${a.url}):\n${text}`);
    used.push({ title: `${a.title} — Wikipedia`, uri: a.url });
  });
  const sourceText = blocks.join('\n\n');

  // Smaller batches on Groq keep each request under its tokens-per-minute cap.
  const perCall = cfg.provider === 'groq' ? 2 : 5;
  const raws: string[] = [];
  for (let i = 0; i < todo.length; i += perCall) {
    const group = todo.slice(i, i + perCall);
    const sections = group
      .map((c) => `=== CATEGORY: ${c} ===\nQuestion: "${queryFor(c)}"\nGuidance: ${GUIDANCE[c]}`)
      .join('\n\n');
    const prompt = `You are the writer for a walking-tour audio guide.
Building: ${label}${building.neighborhood ? `, ${building.neighborhood}` : ''} (lat ${building.location.lat.toFixed(5)}, lng ${building.location.lng.toFixed(5)}).

SOURCES (the only facts you may use):
${sourceText}

Rules:
- Sources may describe neighboring places. Use a source only if it is clearly about this exact building (matching address or name). Otherwise answer NOTABLE: NO for that category.
- Never add names, dates or events that are not in the sources. If the sources do not support a category, answer NOTABLE: NO.
- Write flowing narrative prose for text-to-speech: no markdown, bullets, headings, citations or URLs. Sources may be in another language; write the narrative entirely in ${language}.

${sections}

Respond for EVERY category in exactly this format:
=== CATEGORY: <id> ===
NOTABLE: YES or NO
HEADLINE: <one line, max 12 words>
NARRATIVE:
<narrative, or one sentence explaining why not notable>`;

    const raw = (await generateText(prompt, { maxOutputTokens: 2200 * group.length + 800, signal: opts.signal })).replace(/\r/g, '');
    raws.push(raw);

    for (const c of group) {
      const m = raw.match(new RegExp(`=== CATEGORY:\\s*${c}\\s*===([\\s\\S]*?)(?==== CATEGORY:|$)`, 'i'));
      const block = m?.[1] || '';
      const yes = /NOTABLE:\s*YES/i.test(block);
      const headline = (block.match(/HEADLINE:\s*(.+)/i)?.[1] || '').trim();
      const narrative = cleanForSpeech(block.split(/NARRATIVE:\s*/i)[1] || '');
      const wordCount = narrative.split(/\s+/).filter(Boolean).length;
      const isNotable = yes && wordCount >= 80;
      const finding = mk(
        c,
        isNotable,
        isNotable ? headline || building.displayName || building.streetAddress : 'No notable match found',
        narrative || 'The available sources do not support this category.',
        isNotable ? wordCount : 0,
        used
      );
      done.set(c, finding);
      if (block) sessionCache.set(cacheKey(c), finding);
    }
  }

  return {
    findings: ordered(),
    rawAiResponse: JSON.stringify({ sources: used.map((u) => u.title), model: raws }, null, 2),
  };
}

/** Two-sentence reminder spoken when a walker passes a building a second time. */
export async function generateRecap(input: {
  streetAddress: string;
  displayName?: string;
  findings: Array<{ categoryId: string; headline: string; summary: string }>;
  guideLanguage?: string;
}): Promise<string> {
  const digest = input.findings.map((f) => `${f.categoryId} (${f.headline}): ${f.summary.slice(0, 260)}`).join('\n');
  const lang = input.guideLanguage ? ` Write the recap entirely in ${input.guideLanguage}.` : '';
  const text = await generateText(
    `Create a warm, natural 2-sentence audio recap for a walker passing ${input.displayName ? `${input.displayName} at ` : ''}${input.streetAddress} a second time. Remind them what made this stop notable based on:\n${digest}.${lang}`,
    { maxOutputTokens: 400 }
  );
  return text.trim();
}
