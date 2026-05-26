import { useTranslation } from 'react-i18next';

export default function TermsPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">{t('terms.label')}</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">{t('terms.title')}</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.acceptanceTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.acceptanceDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.serviceTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.serviceDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.aiContentTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed mb-3">{t('terms.aiContentDesc')}</p>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('terms.aiContent1')}</li>
              <li>{t('terms.aiContent2')}</li>
              <li>{t('terms.aiContent3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.userConductTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('terms.userConduct1')}</li>
              <li>{t('terms.userConduct2')}</li>
              <li>{t('terms.userConduct3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.ipTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.ipDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.disclaimerTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.disclaimerDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.limitationTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.limitationDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.terminationTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.terminationDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.changesTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.changesDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('terms.contactTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('terms.contactDesc')}</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.home')}</a>
          <a href="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.privacy')}</a>
          <a href="/about" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.about')}</a>
        </div>
      </main>
    </div>
  );
}
