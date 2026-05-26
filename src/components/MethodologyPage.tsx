import { useTranslation } from 'react-i18next';

export default function MethodologyPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">{t('methodology.label')}</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">{t('methodology.title')}</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('methodology.pipelineTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed mb-4">{t('methodology.pipelineDesc')}</p>
            <ol className="text-neutral-300 space-y-3 list-decimal list-inside">
              <li><strong className="text-white">{t('methodology.phase1')}</strong> — {t('methodology.phase1Desc')}</li>
              <li><strong className="text-white">{t('methodology.phase2')}</strong> — {t('methodology.phase2Desc')}</li>
              <li><strong className="text-white">{t('methodology.phase3')}</strong> — {t('methodology.phase3Desc')}</li>
              <li><strong className="text-white">{t('methodology.phase4')}</strong> — {t('methodology.phase4Desc')}</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('methodology.dataSourcesTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('methodology.dataSource1')}</li>
              <li>{t('methodology.dataSource2')}</li>
              <li>{t('methodology.dataSource3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('methodology.scoringTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('methodology.scoring1')}</li>
              <li>{t('methodology.scoring2')}</li>
              <li>{t('methodology.scoring3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('methodology.editorialTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('methodology.editorial1')}</li>
              <li>{t('methodology.editorial2')}</li>
              <li>{t('methodology.editorial3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('methodology.limitationsTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('methodology.limitation1')}</li>
              <li>{t('methodology.limitation2')}</li>
              <li>{t('methodology.limitation3')}</li>
            </ul>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-wrap gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.home')}</a>
          <a href="/about" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.about')}</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.popularComparisons')}</a>
          <a href="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.privacy')}</a>
          <a href="/terms" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.terms')}</a>
        </div>
      </main>
    </div>
  );
}
