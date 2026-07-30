import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeLanguage, SUPPORTED_LANGUAGES, switchLanguage, type SupportedLanguage } from '../i18n';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

const SHORT_LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'EN',
  'zh-CN': '简',
  'zh-TW': '繁',
};

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const selectorLabel = t('language.selector');

  return (
    <div className="fixed right-3 top-3 z-50 max-w-[calc(100vw-8rem)] md:right-4 md:top-4 md:max-w-none">
      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/80 p-1 shadow-lg backdrop-blur-md md:hidden">
        <Languages size={15} className="ml-1.5 shrink-0 text-neutral-400" aria-hidden="true" />
        <label htmlFor="mobile-language-selector" className="sr-only">
          {selectorLabel}
        </label>
        <select
          id="mobile-language-selector"
          value={currentLanguage}
          onChange={(event) => switchLanguage(event.target.value as SupportedLanguage)}
          aria-label={selectorLabel}
          title={`${selectorLabel}: ${LANGUAGE_LABELS[currentLanguage]}`}
          className="w-12 rounded-full border-0 bg-indigo-600 px-2 py-1 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option
              key={language}
              value={language}
              lang={language}
              aria-label={LANGUAGE_LABELS[language]}
            >
              {SHORT_LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
      </div>

      <div
        className="hidden items-center gap-1 rounded-full border border-white/10 bg-neutral-950/70 p-1 shadow-lg backdrop-blur-md md:flex"
        role="group"
        aria-label={selectorLabel}
      >
        <Languages size={15} className="ml-2 mr-1 text-neutral-400" aria-hidden="true" />
        {SUPPORTED_LANGUAGES.map((language) => {
          const active = currentLanguage === language;
          return (
            <button
              key={language}
              type="button"
              onClick={() => switchLanguage(language)}
              aria-pressed={active}
              lang={language}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'
              }`}
            >
              {LANGUAGE_LABELS[language]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
