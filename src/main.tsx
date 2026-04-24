import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AuthProvider} from './lib/auth';
import './index.css';

// Standalone mount logic
const rootElement = document.getElementById('vagabond-widget-root') || document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
}

// Export for manual mounting if needed
export function mountVagabondWidget(elementId: string) {
  const el = document.getElementById(elementId);
  if (el) {
    createRoot(el).render(
      <StrictMode>
        <AuthProvider>
          <App />
        </AuthProvider>
      </StrictMode>,
    );
  }
}
