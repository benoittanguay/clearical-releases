import * as Sentry from '@sentry/react'
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
import { ScreenshotAnalysisProvider } from './context/ScreenshotAnalysisContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { AnimationProvider } from './context/AnimationContext.tsx'
import { AudioRecordingProvider } from './context/AudioRecordingContext.tsx'
import { BackgroundActivityProvider } from './context/BackgroundActivityContext'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { SplitAnimationOverlay } from './components/SplitAnimationOverlay.tsx'
import { AuthGate } from './components/AuthGate.tsx'

Sentry.init({
  dsn: 'https://a01158cfbc2b8cf42152325063d94287@o4510863269625856.ingest.us.sentry.io/4510863272378368',
  sendDefaultPii: true,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ['localhost', /^https:\/\/.*\.supabase\.co/],
  enableLogs: true,
});

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
                      <ScreenshotAnalysisProvider>
                        <AudioRecordingProvider>
                          <BackgroundActivityProvider>
                            <AnimationProvider>
                              <App />
                              <SplitAnimationOverlay />
                            </AnimationProvider>
                          </BackgroundActivityProvider>
                        </AudioRecordingProvider>
                      </ScreenshotAnalysisProvider>
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
