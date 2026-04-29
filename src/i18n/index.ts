import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

const STORAGE_KEY = 'app-language';

const detectLanguage = (): string => {
  // 1. 用户之前切换过 → 用记忆值
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    // localStorage 不可用（无痕模式等）→ 继续检测
  }

  // 2. 首次访问 → 读取浏览器/操作系统语言
  // 返回格式: "zh-CN", "zh-TW", "en-US", "en-GB", "ja-JP"...
  const browserLang = navigator.language.toLowerCase();

  if (browserLang === 'zh-cn') return 'zh-CN';
  if (['zh-tw', 'zh-hk', 'zh-mo'].includes(browserLang)) return 'zh-TW';
  if (browserLang.startsWith('zh')) return 'zh-CN'; // "zh" 通用标签 → 默认简体
  if (browserLang.startsWith('en')) return 'en';

  return 'en'; // fallback
};

export const switchLanguage = (lang: string): void => {
  i18n.changeLanguage(lang);
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
    interpolation: { escapeValue: false }
  });

export default i18n;
