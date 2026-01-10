import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type SubscriptionTier = 'free' | 'workplace';

export interface SubscriptionStatus {
    tier: SubscriptionTier;
    isActive: boolean;
    expiresAt?: number;
    features: string[];
}

interface SubscriptionContextType {
    subscription: SubscriptionStatus;
    isLoading: boolean;
    hasFeature: (featureName: string) => boolean;
    refreshSubscription: () => Promise<void>;
    upgrade: (email: string) => Promise<{ success: boolean; error?: string }>;
    openCustomerPortal: () => Promise<{ success: boolean; error?: string }>;
}

const defaultSubscription: SubscriptionStatus = {
    tier: 'free',
    isActive: false,
    features: []
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [subscription, setSubscription] = useState<SubscriptionStatus>(defaultSubscription);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const fetchSubscriptionStatus = useCallback(async () => {
        try {
            setIsLoading(true);
            // Call IPC handler to get subscription status from main process
            const status = await window.electron.ipcRenderer.invoke('subscription:get-status');

            if (status && typeof status === 'object') {
                setSubscription({
                    tier: status.tier || 'free',
                    isActive: status.isActive || false,
                    expiresAt: status.expiresAt,
                    features: status.features || []
                });
            } else {
                // Fallback to free tier if response is invalid
                console.warn('[SubscriptionContext] Invalid subscription status response, defaulting to free tier');
                setSubscription(defaultSubscription);
            }
        } catch (error) {
            console.error('[SubscriptionContext] Failed to fetch subscription status:', error);
            // Fallback to free tier on error
            setSubscription(defaultSubscription);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Load subscription status on mount
    useEffect(() => {
        fetchSubscriptionStatus();
    }, [fetchSubscriptionStatus]);

    // Helper to check if a feature is available
    const hasFeature = useCallback((featureName: string): boolean => {
        // If not active or free tier, no premium features
        if (!subscription.isActive || subscription.tier === 'free') {
            return false;
        }

        // Check if feature is in the features array
        return subscription.features.includes(featureName);
    }, [subscription]);

    const refreshSubscription = useCallback(async () => {
        await fetchSubscriptionStatus();
    }, [fetchSubscriptionStatus]);

    // Upgrade to workplace plan - opens Stripe Checkout
    const upgrade = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
        try {
            console.log('[SubscriptionContext] Starting upgrade flow for:', email);
            const result = await window.electron.ipcRenderer.invoke('subscription:subscribe', email, 'workplace_monthly');

            if (result.success) {
                console.log('[SubscriptionContext] Checkout session created, URL opened in browser');
                // Refresh subscription status after a delay (user may complete checkout)
                setTimeout(() => refreshSubscription(), 5000);
                return { success: true };
            } else {
                console.error('[SubscriptionContext] Upgrade failed:', result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('[SubscriptionContext] Upgrade error:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }, [refreshSubscription]);

    // Open customer portal for managing subscription
    const openCustomerPortal = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        try {
            console.log('[SubscriptionContext] Opening customer portal');
            const result = await window.electron.ipcRenderer.invoke('subscription:open-portal');

            if (result.success) {
                return { success: true };
            } else {
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error('[SubscriptionContext] Portal error:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }, []);

    return (
        <SubscriptionContext.Provider
            value={{
                subscription,
                isLoading,
                hasFeature,
                refreshSubscription,
                upgrade,
                openCustomerPortal
            }}
        >
            {children}
        </SubscriptionContext.Provider>
    );
};

export const useSubscription = () => {
    const context = useContext(SubscriptionContext);
    if (!context) {
        throw new Error('useSubscription must be used within a SubscriptionProvider');
    }
    return context;
};
