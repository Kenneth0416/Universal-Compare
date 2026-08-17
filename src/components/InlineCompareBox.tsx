import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MAX_ITEM_LENGTH = 120;

/** One-shot handoff to the homepage generator (consumed on mount in App.tsx).
 *  Deliberately not a URL param, so crawlers following report-page links can
 *  never trigger a paid generation. */
const PREFILL_STORAGE_KEY = 'compareai.prefill';

interface InlineCompareBoxProps {
  /** Current report's entities; used to derive the suggestion chips. */
  suggestFrom?: string[];
}

const normalizeItem = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export default function InlineCompareBox({ suggestFrom = [] }: InlineCompareBoxProps) {
  const { t } = useTranslation();
  const [itemA, setItemA] = useState('');
  const [itemB, setItemB] = useState('');
  const [validationError, setValidationError] = useState('');
  const firstInputRef = useRef<HTMLInputElement>(null);
  const secondInputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggestFrom
    .map((item) => item.trim())
    .filter((item) => item && item.length <= MAX_ITEM_LENGTH)
    .slice(0, 3);

  const applySuggestion = (item: string) => {
    setItemA(item);
    setItemB('');
    setValidationError('');
    secondInputRef.current?.focus();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const itemASnapshot = itemA.trim();
    const itemBSnapshot = itemB.trim();

    if (!itemASnapshot || !itemBSnapshot) {
      setValidationError(t('error.itemsRequired'));
      firstInputRef.current?.focus();
      return;
    }
    if (itemASnapshot.length > MAX_ITEM_LENGTH || itemBSnapshot.length > MAX_ITEM_LENGTH) {
      setValidationError(t('error.itemTooLong', { count: MAX_ITEM_LENGTH }));
      firstInputRef.current?.focus();
      return;
    }
    if (normalizeItem(itemASnapshot) === normalizeItem(itemBSnapshot)) {
      setValidationError(t('error.itemsMustDiffer'));
      firstInputRef.current?.focus();
      return;
    }

    try {
      window.sessionStorage.setItem(PREFILL_STORAGE_KEY, JSON.stringify({
        itemA: itemASnapshot,
        itemB: itemBSnapshot,
        autostart: true,
        ts: Date.now(),
      }));
    } catch {
      // Private-mode storage failures still land the user on the homepage form.
    }
    window.location.href = '/';
  };

  return (
    <section className="mt-12">
      <h2 className="mb-1 text-center text-xl font-bold text-white sm:text-2xl">
        {t('inlineCompare.title')}
      </h2>
      <p className="mb-5 text-center text-sm text-neutral-500">{t('inlineCompare.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-xl backdrop-blur-xl sm:flex-row sm:gap-4">
          <div className="relative w-full flex-1">
            <label htmlFor="inline-compare-item-a" className="sr-only">{t('loading.itemA')}</label>
            <input
              ref={firstInputRef}
              id="inline-compare-item-a"
              type="text"
              value={itemA}
              onChange={(event) => {
                setItemA(event.target.value);
                setValidationError('');
              }}
              placeholder={t('hero.placeholderA')}
              aria-label={t('loading.itemA')}
              aria-describedby={validationError ? 'inline-compare-error' : undefined}
              aria-invalid={Boolean(validationError)}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="words"
              maxLength={MAX_ITEM_LENGTH}
              className="w-full bg-transparent px-4 py-3 text-base font-medium text-white outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
              required
            />
          </div>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/5 bg-white/10 text-neutral-400 sm:flex">
            <span className="font-mono text-sm font-bold">VS</span>
          </div>
          <div className="relative w-full flex-1 border-t-2 border-white/20 sm:border-t-0 sm:border-l-2">
            <label htmlFor="inline-compare-item-b" className="sr-only">{t('loading.itemB')}</label>
            <input
              ref={secondInputRef}
              id="inline-compare-item-b"
              type="text"
              value={itemB}
              onChange={(event) => {
                setItemB(event.target.value);
                setValidationError('');
              }}
              placeholder={t('hero.placeholderB')}
              aria-label={t('loading.itemB')}
              aria-describedby={validationError ? 'inline-compare-error' : undefined}
              aria-invalid={Boolean(validationError)}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="words"
              maxLength={MAX_ITEM_LENGTH}
              className="w-full bg-transparent px-4 py-3 text-base font-medium text-white outline-none placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
              required
            />
          </div>
          <button
            type="submit"
            disabled={!itemA.trim() || !itemB.trim()}
            aria-label={t('hero.compareBtn')}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto"
          >
            <span>{t('hero.compareBtn')}</span>
            <Search size={18} aria-hidden="true" />
          </button>
        </div>

        {suggestions.length > 0 && (
          <div
            role="group"
            aria-label={t('inlineCompare.chipsLabel')}
            className="mt-3 flex flex-wrap justify-center gap-2"
          >
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => applySuggestion(item)}
                className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-neutral-400 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {t('inlineCompare.chip', { item })}
              </button>
            ))}
          </div>
        )}

        {validationError && (
          <p id="inline-compare-error" role="alert" className="mt-3 text-center text-sm text-rose-400">
            {validationError}
          </p>
        )}
      </form>
    </section>
  );
}
