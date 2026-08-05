import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Clock } from 'lucide-react';
import MinimalGrid from './react-bits/MinimalGrid';
import { getMyActivity, type MyActivity } from '../services/serverGenerationService';
import { useTranslation } from 'react-i18next';

export default function MyReportsPage() {
  const { t, i18n } = useTranslation();
  const [activity, setActivity] = useState<MyActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  useEffect(() => {
    document.title = t('myReports.pageTitle');
  }, [language, t]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMyActivity()
      .then((data) => {
        if (active) setActivity(data);
      })
      .catch(() => {
        if (active) setActivity({ reports: [], activeRuns: [] });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(language, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso.slice(0, 10);
    }
  };

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
            {t('myReports.label')}
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
            {t('myReports.title')}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-neutral-400">
            {t('myReports.description')}
          </p>
        </header>

        <section aria-live="polite" aria-busy={loading}>
          {loading && (
            <div className="flex items-center gap-3 py-16 text-neutral-400" role="status">
              <Loader2 className="animate-spin text-indigo-400" size={24} aria-hidden="true" />
              <span>{t('myReports.loading')}</span>
            </div>
          )}

          {!loading && activity && activity.activeRuns.length > 0 && (
            <div className="mb-8 rounded-2xl border border-indigo-400/30 bg-indigo-400/[0.08] p-5">
              <div className="flex items-center gap-2 text-indigo-200">
                <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                <span className="text-sm font-semibold">{t('myReports.generating')}</span>
              </div>
              {activity.activeRuns.map((run) => (
                <a key={run.runId} href="/" className="mt-2 block text-white hover:text-indigo-200">
                  {run.itemA} <span className="text-xs text-neutral-500">vs</span> {run.itemB}
                </a>
              ))}
            </div>
          )}

          {!loading && activity && (
            activity.reports.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activity.reports.map((report) => (
                  <a
                    key={report.reportId}
                    href={report.url}
                    className="group block rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-all hover:border-indigo-500/40 hover:bg-white/[0.07]"
                  >
                    <h2 className="text-lg font-semibold text-white">
                      {report.itemA} <span className="text-xs font-normal text-neutral-600">vs</span> {report.itemB}
                    </h2>
                    <p className="mt-3 flex items-center gap-1.5 text-sm text-neutral-500">
                      <Clock size={13} aria-hidden="true" />
                      {formatDate(report.createdAt)}
                    </p>
                    <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-400">
                      <span>{t('myReports.viewReport')}</span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              activity.activeRuns.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                  <p className="text-neutral-400">{t('myReports.empty')}</p>
                  <a
                    href="/"
                    className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
                  >
                    {t('myReports.startFirst')}
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </div>
              )
            )
          )}
        </section>
      </main>
    </div>
  );
}
