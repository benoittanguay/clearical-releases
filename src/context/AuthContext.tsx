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
    signOut: () => Promise<void>;
    openCustomerPortal: () => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check authentication status on mount
    useEffect(() => {
        checkAuthStatus();
    }, []);

    const checkAuthStatus = async () => {
        try {
            setIsLoading(true);
            const isAuth = await window.electron.ipcRenderer.invoke('auth:is-authenticated');

            if (isAuth) {
                const result = await window.electron.ipcRenderer.invoke('auth:get-user');
                if (result.success && result.user) {
                    setUser(result.user);
                }
            }
        } catch (error) {
            console.error('[AuthContext] Failed to check auth status:', error);
        } finally {
            setIsLoading(false);
        }
    };

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
                signOut,
                openCustomerPortal,
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
