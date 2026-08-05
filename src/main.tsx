import './i18n';
import React, {lazy, StrictMode, Suspense, type ComponentType} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import {useTranslation} from 'react-i18next';
import LanguageSwitcher from './components/LanguageSwitcher.tsx';
import i18n from './i18n';
import './index.css';

const pathname = window.location.pathname;
const isAdminRoute = pathname.startsWith('/admin');
let loadRootApp: () => Promise<{ default: ComponentType }>;

if (isAdminRoute) {
  loadRootApp = () => import('./admin/AdminApp.tsx');
} else if (pathname === '/methodology') {
  loadRootApp = () => import('./components/MethodologyPage.tsx');
} else if (pathname === '/about') {
  loadRootApp = () => import('./components/AboutPage.tsx');
} else if (pathname === '/privacy') {
  loadRootApp = () => import('./components/PrivacyPolicyPage.tsx');
} else if (pathname === '/terms') {
  loadRootApp = () => import('./components/TermsPage.tsx');
} else if (pathname.startsWith('/r/') || pathname.startsWith('/compare/')) {
  loadRootApp = () => import('./components/ReportViewer.tsx');
} else if (pathname === '/popular-ai-comparisons') {
  loadRootApp = () => import('./components/PopularComparisonsPage.tsx');
} else if (pathname === '/my-reports') {
  loadRootApp = () => import('./components/MyReportsPage.tsx');
} else {
  loadRootApp = () => import('./App.tsx');
}

const RootApp = lazy(loadRootApp);

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class RouteErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState { return { hasError: true }; }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050505] px-4 text-neutral-300">
        <p role="alert">{i18n.t('error.pageLoadFailed')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {i18n.t('error.reload')}
        </button>
      </main>
    );
  }
}

function PageLoadingFallback() {
  const {t} = useTranslation();
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-neutral-300"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="animate-pulse">{t('report.loading')}</span>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {isAdminRoute ? null : <LanguageSwitcher />}
      <RouteErrorBoundary>
        <Suspense fallback={<PageLoadingFallback />}>
          <RootApp />
        </Suspense>
      </RouteErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);
