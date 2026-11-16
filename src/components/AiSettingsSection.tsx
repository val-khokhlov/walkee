import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { loadAiConfig, saveAiConfig, type AiConfig, type AiProvider } from '../services/aiConfig';
import { listModels } from '../services/llm';

const PROVIDERS: Array<{ id: AiProvider; name: string; keyUrl: string; keyHost: string }> = [
  { id: 'gemini', name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHost: 'aistudio.google.com/apikey' },
  { id: 'groq', name: 'Groq', keyUrl: 'https://console.groq.com/keys', keyHost: 'console.groq.com/keys' },
];

const inputClass =
  'w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#ddc0ba]/70 rounded-xl text-[#111c2d] focus:outline-none focus:border-[#0D9488]';
const labelClass = 'block text-xs font-semibold text-[#57423d] mb-1.5';

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string };

export const AiSettingsSection: React.FC = () => {
  const [cfg, setCfg] = useState<AiConfig>(loadAiConfig);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });

  const update = (partial: Partial<AiConfig>) => setCfg(saveAiConfig(partial));
  const updateNumber = (field: 'maxRpm' | 'maxBuildings', value: string) => {
    const n = Number(value);
    if (Number.isFinite(n)) update({ [field]: n });
  };

  const provider = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0];
  const isGroq = cfg.provider === 'groq';
  const keyValue = isGroq ? cfg.groqKey : cfg.geminiKey;
  const modelValue = isGroq ? cfg.groqModel : cfg.geminiModel;

  const testConnection = async () => {
    setStatus({ kind: 'busy', text: 'Checking the key…' });
    try {
      const ids = await listModels(cfg.provider, keyValue);
      setModels(ids);
      setStatus({
        kind: 'ok',
        text: ids.includes(modelValue.trim().replace(/^models\//, ''))
          ? `Key works. ${ids.length} models available, including the one selected.`
          : `Key works, but "${modelValue}" is not in your list. Pick one of the ${ids.length} suggested models.`,
      });
    } catch (e) {
      setModels([]);
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Could not reach the provider.' });
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-[#ddc0ba]/50 p-5 space-y-4 shadow-xs">
      <div className="flex items-start gap-2">
        <KeyRound className="w-4 h-4 text-[#57423d] mt-0.5 shrink-0" />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#57423d]">AI provider</h2>
          <p className="text-xs text-[#8a726c] mt-0.5 leading-relaxed">
            Stories are written with your own free key, so usage counts against your quota only. The key stays on this
            device and is sent only to the provider you choose.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="AI provider">
        {PROVIDERS.map((p) => {
          const selected = cfg.provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                update({ provider: p.id });
                setModels([]);
                setStatus({ kind: 'idle', text: '' });
              }}
              className={`min-h-[44px] px-3 py-2 rounded-xl border text-sm font-bold transition-colors ${
                selected
                  ? 'bg-[#f0f3ff] border-[#0D9488] text-[#111c2d]'
                  : 'bg-white border-[#e7eeff] text-[#57423d] hover:border-[#ddc0ba]'
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="ai-key" className={labelClass}>
          {provider.name} API key
        </label>
        <input
          id="ai-key"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={keyValue}
          onChange={(e) => update(isGroq ? { groqKey: e.target.value } : { geminiKey: e.target.value })}
          placeholder="Paste your key"
          className={inputClass}
        />
        <p className="text-[11px] text-[#8a726c] mt-1.5">
          Get a free key at{' '}
          <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[#0D9488] hover:underline">
            {provider.keyHost}
          </a>
          .
        </p>
      </div>

      <div>
        <label htmlFor="ai-model" className={labelClass}>
          Model
        </label>
        <input
          id="ai-model"
          type="text"
          list="ai-model-options"
          autoCapitalize="off"
          spellCheck={false}
          value={modelValue}
          onChange={(e) => update(isGroq ? { groqModel: e.target.value } : { geminiModel: e.target.value })}
          className={inputClass}
        />
        <datalist id="ai-model-options">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={!keyValue.trim() || status.kind === 'busy'}
          className="px-3.5 py-2 min-h-[40px] rounded-xl bg-[#0D9488] hover:bg-[#006a61] disabled:bg-[#cbd5e1] text-white text-xs font-semibold transition-colors"
        >
          Test connection
        </button>
        {status.text && (
          <p
            role="status"
            className={`text-xs leading-snug flex-1 min-w-[200px] ${
              status.kind === 'error' ? 'text-[#93000a]' : status.kind === 'ok' ? 'text-[#006a61]' : 'text-[#57423d]'
            }`}
          >
            {status.text}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ai-rpm" className={labelClass}>
            Requests per minute
          </label>
          <input
            id="ai-rpm"
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            value={cfg.maxRpm}
            onChange={(e) => updateNumber('maxRpm', e.target.value)}
            className={inputClass}
          />
          <p className="text-[11px] text-[#8a726c] mt-1.5">Set this just below the limit shown in your provider console.</p>
        </div>
        <div>
          <label htmlFor="ai-max-buildings" className={labelClass}>
            Buildings per route
          </label>
          <input
            id="ai-max-buildings"
            type="number"
            min={1}
            max={250}
            inputMode="numeric"
            value={cfg.maxBuildings}
            onChange={(e) => updateNumber('maxBuildings', e.target.value)}
            className={inputClass}
          />
          <p className="text-[11px] text-[#8a726c] mt-1.5">Buildings with the best-documented history are researched first.</p>
        </div>
      </div>

      <div>
        <label htmlFor="ai-wiki-langs" className={labelClass}>
          Wikipedia languages
        </label>
        <input
          id="ai-wiki-langs"
          type="text"
          autoCapitalize="off"
          spellCheck={false}
          value={cfg.wikiLangs}
          onChange={(e) => update({ wikiLangs: e.target.value })}
          placeholder="en,uk"
          className={inputClass}
        />
        <p className="text-[11px] text-[#8a726c] mt-1.5">
          Codes separated by commas. Add the local language of the city you walk in; local Wikipedias often cover far more buildings.
        </p>
      </div>
    </section>
  );
};
