import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import MinimalGrid from './react-bits/MinimalGrid';
import { getPopularComparisons, type PopularComparison } from '../services/popularComparisonService';
import { useTranslation } from 'react-i18next';

export default function PopularComparisonsPage() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<PopularComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  useEffect(() => {
    document.title = t('popular.pageTitle');
  }, [language, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);

    getPopularComparisons(language, 48)
      .then((comparisons) => {
        if (active) setItems(comparisons);
      })
      .catch(() => {
        if (active) {
          setItems([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [language]);

  return (
    <div className="min-h-screen font-sans selection:bg-indigo-500/30 selection:text-indigo-200 relative">
      <div className="fixed top-4 left-4 z-50">
        <a
          href="/"
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-sm text-neutral-400 hover:text-white transition-all"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t('nav.home')}
        </a>
      </div>

      <MinimalGrid />

      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto relative z-10">
        <header className="mb-10 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-300 font-mono">
            {t('popular.label')}
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            {t('popular.title')}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-neutral-400">
            {t('popular.description')}
          </p>
        </header>

        <section aria-live="polite" aria-busy={loading} aria-label={t('popular.resultsLabel')}>
          {loading && (
            <div className="flex items-center gap-3 py-16 text-neutral-400" role="status">
              <Loader2 className="animate-spin text-indigo-400" size={24} aria-hidden="true" />
              <span>{t('popular.loading')}</span>
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-6 text-red-200" role="alert">
              {t('popular.error')}
            </div>
          )}

          {!loading && !loadError && (
            items.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <a
                    key={item.id}
                    href={`/compare/${item.slug}`}
                    className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-all hover:border-indigo-500/40 hover:bg-white/[0.07]"
                  >
                    <h2 className="text-lg font-semibold text-white">
                      {item.itemA} <span className="text-xs font-normal text-neutral-600">vs</span> {item.itemB}
                    </h2>
                    {item.description && (
                      <p className="mt-3 text-sm leading-relaxed text-neutral-500">{item.description}</p>
                    )}
                    <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-400">
                      <span>{t('popular.viewReport')}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-neutral-400">
                {t('popular.empty')}
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
}
