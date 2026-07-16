import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, switchLanguage, type SupportedLanguage } from '../i18n';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
};

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage || i18n.language;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/70 p-1 shadow-lg backdrop-blur-md"
      role="group"
      aria-label={t('language.selector')}
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
            className={`rounded-full px-3 py-1 text-sm font-medium transition-all ${
              active ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'
            }`}
          >
            {LANGUAGE_LABELS[language]}
          </button>
        );
      })}
    </div>
  );
}
