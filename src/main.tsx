import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StorageProvider } from './context/StorageContext.tsx'
import { SettingsProvider } from './context/SettingsContext.tsx'
import { SubscriptionProvider } from './context/SubscriptionContext.tsx'
import { ToastProvider } from './context/ToastContext.tsx'
import { JiraCacheProvider } from './context/JiraCacheContext.tsx'
import { CrawlerProgressProvider } from './context/CrawlerProgressContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { AuthGate } from './components/AuthGate.tsx'

// Import seed script to expose console commands in development
if (import.meta.env.DEV) {
  import('./utils/seedScript');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <SubscriptionProvider>
            <SettingsProvider>
              <StorageProvider>
                <ToastProvider>
                  <JiraCacheProvider>
                    <CrawlerProgressProvider>
                      <App />
                    </CrawlerProgressProvider>
                  </JiraCacheProvider>
                </ToastProvider>
              </StorageProvider>
            </SettingsProvider>
          </SubscriptionProvider>
        </AuthGate>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
