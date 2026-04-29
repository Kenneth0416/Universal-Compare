import './i18n';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from './admin/AdminApp.tsx';
import App from './App.tsx';
import './index.css';

const RootApp = window.location.pathname.startsWith('/admin') ? AdminApp : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
