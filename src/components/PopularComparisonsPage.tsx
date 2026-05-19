import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import MinimalGrid from './react-bits/MinimalGrid';
import { getPopularComparisons, type PopularComparison } from '../services/popularComparisonService';

export default function PopularComparisonsPage() {
  const [items, setItems] = useState<PopularComparison[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Popular AI Comparisons | CompareAI';
    getPopularComparisons('en')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen font-sans selection:bg-indigo-500/30 selection:text-indigo-200 relative">
      <div className="fixed top-4 left-4 z-50">
        <a
          href="/"
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-sm text-neutral-400 hover:text-white transition-all"
        >
          <ArrowLeft size={16} />
          Home
        </a>
      </div>

      <MinimalGrid />

      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto relative z-10">
        <header className="mb-10 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-300 font-mono">
            AI comparison directory
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            Popular AI Comparisons
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-neutral-400">
            Browse AI assistant, coding tool, search, and productivity comparisons.
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-3 py-16 text-neutral-400">
            <Loader2 className="animate-spin text-indigo-400" size={24} />
            <span>Loading comparisons...</span>
          </div>
        )}

        {!loading && (
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
                    <span>View report</span>
                    <ArrowRight size={14} />
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-neutral-400">
              New public comparison reports will appear here soon.
            </div>
          )
        )}
      </main>
    </div>
  );
}
