import { useAuth } from '../context/AuthContext';
import { LoginScreen } from './LoginScreen';

// Skip auth in development mode for QA testing
const DEV_SKIP_AUTH = import.meta.env.DEV;

interface AuthGateProps {
    children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
    const { isAuthenticated, isLoading } = useAuth();

    // Bypass auth in development mode
    if (DEV_SKIP_AUTH) {
        return <>{children}</>;
    }

    // Show loading state while checking auth
    if (isLoading) {
        return (
            <div
                className="min-h-screen flex items-center justify-center animate-fade-in"
                style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    fontFamily: 'var(--font-body)'
                }}
            >
                <div className="text-center">
                    <div
                        className="w-14 h-14 border-4 rounded-full animate-spin mx-auto mb-4"
                        style={{
                            borderColor: 'var(--color-accent-muted)',
                            borderTopColor: 'var(--color-accent)'
                        }}
                    ></div>
                    <p
                        className="text-sm font-medium"
                        style={{
                            color: 'var(--color-text-secondary)',
                            fontFamily: 'var(--font-display)'
                        }}
                    >
                        Loading...
                    </p>
                </div>
            </div>
        );
    }

    // Show login screen if not authenticated
    if (!isAuthenticated) {
        return <LoginScreen />;
    }

    // User is authenticated, show the app
    return <>{children}</>;
}
