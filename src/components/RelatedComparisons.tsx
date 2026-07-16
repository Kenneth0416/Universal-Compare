import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { getPopularComparisons, type PopularComparison } from '../services/popularComparisonService';
import { useTranslation } from 'react-i18next';

interface RelatedComparisonsProps {
  currentSlug?: string;
}

export default function RelatedComparisons({ currentSlug }: RelatedComparisonsProps) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<PopularComparison[]>([]);
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  useEffect(() => {
    getPopularComparisons(language)
      .then((comparisons) => {
        setItems(comparisons.filter((item) => item.slug !== currentSlug).slice(0, 6));
      })
      .catch(() => setItems([]));
  }, [currentSlug, language]);

  if (!items.length) return null;

  return (
    <section className="mt-14">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-white">{t('related.title')}</h2>
        <a
          href="/popular-ai-comparisons"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-300 transition-colors hover:text-indigo-200"
        >
          <span>{t('related.viewAll')}</span>
          <ArrowRight size={16} />
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <a
            key={item.id}
            href={`/compare/${item.slug}`}
            className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-all hover:border-indigo-500/40 hover:bg-white/[0.07]"
          >
            <h3 className="text-base font-semibold text-white">
              {item.itemA} <span className="text-xs font-normal text-neutral-600">vs</span> {item.itemB}
            </h3>
            {item.description && (
              <p className="mt-3 text-sm leading-relaxed text-neutral-500">{item.description}</p>
            )}
            <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
              <span>{t('popular.viewReport')}</span>
              <ArrowRight size={12} />
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
