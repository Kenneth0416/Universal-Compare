import { useTranslation } from 'react-i18next';

export default function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">{t('about.label')}</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">{t('about.title')}</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('about.whatWeDoTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('about.whatWeDoDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('about.whyTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('about.whyDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('about.teamTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('about.teamDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('about.editorialTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('about.editorial1')}</li>
              <li>{t('about.editorial2')}</li>
              <li>{t('about.editorial3')}</li>
              <li>{t('about.editorial4')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('about.contactTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('about.contactDesc')}</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.home')}</a>
          <a href="/methodology" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.methodology')}</a>
          <a href="/popular-ai-comparisons" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.popularComparisons')}</a>
        </div>
      </main>
    </div>
  );
}
