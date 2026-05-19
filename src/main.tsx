import './i18n';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from './admin/AdminApp.tsx';
import App from './App.tsx';
import AboutPage from './components/AboutPage.tsx';
import MethodologyPage from './components/MethodologyPage.tsx';
import PopularComparisonsPage from './components/PopularComparisonsPage.tsx';
import ReportViewer from './components/ReportViewer.tsx';
import './index.css';

const pathname = window.location.pathname;
let RootApp;
if (pathname.startsWith('/admin')) {
  RootApp = AdminApp;
} else if (pathname === '/methodology') {
  RootApp = MethodologyPage;
} else if (pathname === '/about') {
  RootApp = AboutPage;
} else if (pathname.startsWith('/r/') || pathname.startsWith('/compare/')) {
  RootApp = ReportViewer;
} else if (pathname === '/popular-ai-comparisons') {
  RootApp = PopularComparisonsPage;
} else {
  RootApp = App;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
