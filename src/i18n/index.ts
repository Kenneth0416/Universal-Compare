import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

const STORAGE_KEY = 'app-language';

export const SUPPORTED_LANGUAGES = ['en', 'zh-CN', 'zh-TW'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const isSupportedLanguage = (value: string | null): value is SupportedLanguage =>
  SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);

export const normalizeLanguage = (value?: string | null): SupportedLanguage => {
  const language = value?.toLowerCase();
  if (language === 'zh-cn' || language?.startsWith('zh-hans')) return 'zh-CN';
  if (language === 'zh-tw' || language === 'zh-hk' || language === 'zh-mo' || language?.startsWith('zh-hant')) return 'zh-TW';
  if (language?.startsWith('zh')) return 'zh-CN';
  return 'en';
};

const detectLanguage = (): SupportedLanguage => {
  // 1. 用户之前切换过 → 用记忆值
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSupportedLanguage(saved)) return saved;
  } catch {
    // localStorage 不可用（无痕模式等）→ 继续检测
  }

  // 2. 首次访问 → 读取浏览器/操作系统语言
  // 返回格式: "zh-CN", "zh-TW", "en-US", "en-GB", "ja-JP"...
  return normalizeLanguage(navigator.language);
};

const syncDocumentLanguage = (lang: string): void => {
  document.documentElement.lang = normalizeLanguage(lang);
};

export const switchLanguage = (lang: SupportedLanguage): void => {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage 不可用 → 静默跳过
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
    },
    lng: detectLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: false,
    load: 'currentOnly',
    interpolation: { escapeValue: false }
  });

syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
