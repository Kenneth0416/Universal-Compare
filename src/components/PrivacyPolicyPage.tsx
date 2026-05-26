import { useTranslation } from 'react-i18next';

export default function PrivacyPolicyPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-[#0a0f1f] text-white">
      <main className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 font-mono">{t('privacy.label')}</p>
        <h1 className="text-3xl sm:text-4xl font-bold mb-8">{t('privacy.title')}</h1>

        <div className="space-y-10">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.introTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.introDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.dataCollectionTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed mb-3">{t('privacy.dataCollectionDesc')}</p>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('privacy.dataCollection1')}</li>
              <li>{t('privacy.dataCollection2')}</li>
              <li>{t('privacy.dataCollection3')}</li>
              <li>{t('privacy.dataCollection4')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.dataUseTitle')}</h2>
            <ul className="text-neutral-300 space-y-2 list-disc list-inside">
              <li>{t('privacy.dataUse1')}</li>
              <li>{t('privacy.dataUse2')}</li>
              <li>{t('privacy.dataUse3')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.aiProcessingTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.aiProcessingDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.cookiesTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.cookiesDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.thirdPartyTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.thirdPartyDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.retentionTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.retentionDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.rightsTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.rightsDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.changesTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.changesDesc')}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">{t('privacy.contactTitle')}</h2>
            <p className="text-neutral-300 leading-relaxed">{t('privacy.contactDesc')}</p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex gap-4 text-sm">
          <a href="/" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.home')}</a>
          <a href="/terms" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.terms')}</a>
          <a href="/about" className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('nav.about')}</a>
        </div>
      </main>
    </div>
  );
}
