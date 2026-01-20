import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface AuthUser {
    id: string;
    email: string;
    stripeCustomerId?: string;
    createdAt: string;
    lastSignIn?: string;
}

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    sendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
    verifyOtp: (email: string, token: string) => Promise<{ success: boolean; error?: string }>;
    signInWithOAuth: (provider: 'google' | 'azure' | 'apple') => Promise<{ success: boolean; error?: string }>;
    signOut: () => Promise<void>;
    openCustomerPortal: () => Promise<{ success: boolean; error?: string }>;
    refreshAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Re-check authentication status (e.g., after session expiry)
    const refreshAuthStatus = useCallback(async () => {
        try {
            setIsLoading(true);
            const isAuth = await window.electron.ipcRenderer.invoke('auth:is-authenticated');

            if (isAuth) {
                const result = await window.electron.ipcRenderer.invoke('auth:get-user');
                if (result.success && result.user) {
                    setUser(result.user);
                } else {
                    // User fetch failed, clear cached user
                    setUser(null);
                }
            } else {
                // Not authenticated anymore, clear cached user
                setUser(null);
            }
        } catch (error) {
            console.error('[AuthContext] Failed to check auth status:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Check authentication status on mount
    useEffect(() => {
        refreshAuthStatus();
    }, [refreshAuthStatus]);

    const sendOtp = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electron.ipcRenderer.invoke('auth:send-otp', email);
            return result;
        } catch (error) {
            console.error('[AuthContext] Send OTP error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to send code'
            };
        }
    }, []);

    const verifyOtp = useCallback(async (email: string, token: string): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electron.ipcRenderer.invoke('auth:verify-otp', email, token);

            if (result.success && result.user) {
                setUser(result.user);
            }

            return result;
        } catch (error) {
            console.error('[AuthContext] Verify OTP error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to verify code'
            };
        }
    }, []);

    const signInWithOAuth = useCallback(async (
        provider: 'google' | 'azure' | 'apple'
    ): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electron.ipcRenderer.signInWithOAuth(provider);

            if (result.success && result.user) {
                setUser(result.user);
            }

            return result;
        } catch (error) {
            console.error('[AuthContext] OAuth sign-in error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to sign in'
            };
        }
    }, []);

    const signOut = useCallback(async () => {
        try {
            await window.electron.ipcRenderer.invoke('auth:sign-out');
            setUser(null);
        } catch (error) {
            console.error('[AuthContext] Sign out error:', error);
        }
    }, []);

    const openCustomerPortal = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electron.ipcRenderer.invoke('auth:open-customer-portal');
            return result;
        } catch (error) {
            console.error('[AuthContext] Open portal error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to open portal'
            };
        }
    }, []);

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading,
                sendOtp,
                verifyOtp,
                signInWithOAuth,
                signOut,
                openCustomerPortal,
                refreshAuthStatus,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
