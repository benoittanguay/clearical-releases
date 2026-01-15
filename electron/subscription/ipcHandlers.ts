/**
 * Subscription IPC Handlers
 *
 * Electron IPC handlers for subscription operations.
 * These handlers bridge the main process subscription logic with the renderer process.
 *
 * MIGRATION NOTE: The StripeClient is being replaced with EdgeFunctionClient.
 * During the transition period, both are available. Once Edge Functions are deployed,
 * remove the stripeSecretKey requirement and use EdgeFunctionClient exclusively.
 */

import { ipcMain, shell } from 'electron';
import {
    SubscriptionValidator,
    SubscriptionStorage,
    StripeClient,
    WebhookServer,
    ValidationResult,
    Subscription,
    SubscriptionEvent,
    SubscriptionPlan,
    SubscriptionStatus,
    DEFAULT_SUBSCRIPTION_CONFIG,
} from './index.js';
import { DeviceFingerprintService } from './deviceFingerprint.js';
import { getConfig } from '../config.js';
import { getEdgeFunctionClient } from './edgeFunctionClient.js';
import { initializeTrialNotifications, cleanupTrialNotifications } from './trialNotifications.js';

// Global subscription validator instance
let subscriptionValidator: SubscriptionValidator | null = null;
let webhookServer: WebhookServer | null = null;

/**
 * Initialize subscription system
 */
export function initializeSubscription(): void {
    console.log('[Subscription] Initializing subscription system...');

    try {
        const appConfig = getConfig();

        // Build config - prefer bundled config, fall back to env vars for development
        const config = {
            ...DEFAULT_SUBSCRIPTION_CONFIG,
            stripeSecretKey: process.env.STRIPE_SECRET_KEY || '', // Still needed for legacy StripeClient
            stripePublishableKey: appConfig.stripe.publishableKey,
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '', // Webhooks now handled by Edge Functions
        };

        console.log('[Subscription] Stripe config loaded:', {
            hasSecretKey: !!config.stripeSecretKey,
            hasPublishableKey: !!config.stripePublishableKey,
            usingEdgeFunctions: !config.stripeSecretKey, // Log if we're using Edge Functions
        });

        // Create validator instance with config
        subscriptionValidator = new SubscriptionValidator(config);

        // Register IPC handlers
        registerIpcHandlers();

        // Set up event logging
        subscriptionValidator.addEventListener((event: SubscriptionEvent) => {
            console.log('[Subscription] Event:', event.type, event);
            // TODO: Send events to analytics service
        });

        // Start webhook server if webhooks are enabled and we have a secret
        if (config.enableWebhooks && config.stripeWebhookSecret) {
            const stripeClient = subscriptionValidator.getStripeClient();
            webhookServer = new WebhookServer(config, stripeClient);
            webhookServer.start().then(() => {
                console.log('[Subscription] Webhook server started on port', webhookServer?.getPort());
            }).catch((error) => {
                console.error('[Subscription] Failed to start webhook server:', error);
            });
        } else {
            console.log('[Subscription] Webhook server not started (webhooks disabled or no secret)');
        }

        // Initialize trial notification system
        initializeTrialNotifications();

        console.log('[Subscription] Subscription system initialized');
    } catch (error) {
        console.error('[Subscription] Failed to initialize:', error);
        throw error;
    }
}

/**
 * Register all subscription-related IPC handlers
 */
function registerIpcHandlers(): void {
    // Validate subscription
    ipcMain.handle('subscription:validate', handleValidateSubscription);

    // Get subscription info
    ipcMain.handle('subscription:get-info', handleGetSubscriptionInfo);

    // Get subscription status (simplified for UI)
    ipcMain.handle('subscription:get-status', handleGetSubscriptionStatus);

    // Check feature access
    ipcMain.handle('subscription:has-feature', handleHasFeature);

    // Trial info
    ipcMain.handle('subscription:get-trial-info', handleGetTrialInfo);

    // Stripe Checkout
    ipcMain.handle('subscription:create-checkout', handleCreateCheckout);

    // Customer Portal
    ipcMain.handle('subscription:open-portal', handleOpenCustomerPortal);

    // Subscribe with email
    ipcMain.handle('subscription:subscribe', handleSubscribe);

    // Cancel subscription
    ipcMain.handle('subscription:cancel', handleCancelSubscription);

    console.log('[Subscription] IPC handlers registered');
}

/**
 * Validate subscription handler
 */
async function handleValidateSubscription(): Promise<{
    success: boolean;
    result?: ValidationResult;
    error?: string;
}> {
    try {
        if (!subscriptionValidator) {
            throw new Error('Subscription validator not initialized');
        }

        const result = await subscriptionValidator.validate();

        console.log('[Subscription] Validation result:', {
            valid: result.valid,
            mode: result.mode,
            status: result.subscription?.status,
            plan: result.subscription?.plan,
        });

        return {
            success: true,
            result,
        };
    } catch (error) {
        console.error('[Subscription] Validation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get subscription info handler
 */
async function handleGetSubscriptionInfo(): Promise<{
    success: boolean;
    subscription?: Subscription;
    error?: string;
}> {
    try {
        let subscription = await SubscriptionStorage.getSubscription();

        // If no subscription exists, trigger validation to create trial
        if (!subscription) {
            console.log('[Subscription] No subscription found in info request, triggering validation to create trial');

            if (subscriptionValidator) {
                const validationResult = await subscriptionValidator.validate();
                subscription = validationResult.subscription;

                console.log('[Subscription] Validation result for info request:', {
                    valid: validationResult.valid,
                    mode: validationResult.mode,
                    status: subscription.status,
                });
            } else {
                // Fallback if validator not initialized
                console.warn('[Subscription] Validator not initialized, returning undefined');
                return {
                    success: true,
                    subscription: undefined,
                };
            }
        }

        console.log('[Subscription] Info retrieved:', {
            status: subscription.status,
            plan: subscription.plan,
            email: subscription.email,
        });

        return {
            success: true,
            subscription,
        };
    } catch (error) {
        console.error('[Subscription] Failed to get info:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get subscription status handler (simplified for UI)
 * Returns a simplified status object for the SubscriptionContext
 */
async function handleGetSubscriptionStatus(): Promise<{
    tier: 'free' | 'workplace';
    isActive: boolean;
    expiresAt?: number;
    features: string[];
}> {
    try {
        let subscription = await SubscriptionStorage.getSubscription();

        // If no subscription exists, trigger validation to create trial
        if (!subscription) {
            console.log('[Subscription] No subscription found, triggering validation to create trial');

            if (subscriptionValidator) {
                const validationResult = await subscriptionValidator.validate();
                subscription = validationResult.subscription;

                console.log('[Subscription] Validation result:', {
                    valid: validationResult.valid,
                    mode: validationResult.mode,
                    status: subscription.status,
                });
            } else {
                // Fallback if validator not initialized
                console.warn('[Subscription] Validator not initialized, returning free tier');
                return {
                    tier: 'free',
                    isActive: false,
                    features: [],
                };
            }
        }

        // Check if subscription allows premium features
        const isPremium = ['trial', 'active', 'past_due'].includes(subscription.status);

        // Determine tier based on plan or trial status
        const tier: 'free' | 'workplace' =
            subscription.status === 'trial' ||
            subscription.plan === SubscriptionPlan.WORKPLACE_MONTHLY ||
            subscription.plan === SubscriptionPlan.WORKPLACE_YEARLY
                ? 'workplace'
                : 'free';

        // Build features array from feature flags
        const features: string[] = [];
        if (subscription.features.jiraIntegration) features.push('jira');
        if (subscription.features.tempoIntegration) features.push('tempo');
        if (subscription.features.aiAnalysis) features.push('ai');
        if (subscription.features.advancedReporting) features.push('reporting');

        return {
            tier,
            isActive: isPremium,
            expiresAt: subscription.currentPeriodEnd,
            features,
        };
    } catch (error) {
        console.error('[Subscription] Failed to get status:', error);
        return {
            tier: 'free',
            isActive: false,
            features: [],
        };
    }
}

/**
 * Check feature access handler
 */
async function handleHasFeature(
    event: Electron.IpcMainInvokeEvent,
    featureName: string
): Promise<{
    success: boolean;
    hasFeature?: boolean;
    error?: string;
}> {
    try {
        if (!subscriptionValidator) {
            throw new Error('Subscription validator not initialized');
        }

        const hasFeature = await subscriptionValidator.hasFeature(
            featureName as keyof Subscription['features']
        );

        return {
            success: true,
            hasFeature,
        };
    } catch (error) {
        console.error('[Subscription] Failed to check feature:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get trial info handler
 */
async function handleGetTrialInfo(): Promise<{
    success: boolean;
    isTrial?: boolean;
    daysRemaining?: number;
    trialEndsAt?: number;
    error?: string;
}> {
    try {
        let subscription = await SubscriptionStorage.getSubscription();

        // If no subscription exists, trigger validation to create trial
        if (!subscription) {
            console.log('[Subscription] No subscription found in trial info, triggering validation to create trial');

            if (subscriptionValidator) {
                const validationResult = await subscriptionValidator.validate();
                subscription = validationResult.subscription;

                console.log('[Subscription] Validation result for trial info:', {
                    valid: validationResult.valid,
                    mode: validationResult.mode,
                    status: subscription.status,
                });
            } else {
                // Fallback if validator not initialized
                console.warn('[Subscription] Validator not initialized, returning no trial');
                return {
                    success: true,
                    isTrial: false,
                    daysRemaining: 0,
                };
            }
        }

        const isTrial = subscription.status === 'trial';
        const daysRemaining = SubscriptionValidator.getTrialDaysRemaining(subscription);

        return {
            success: true,
            isTrial,
            daysRemaining,
            trialEndsAt: subscription.trialEndsAt,
        };
    } catch (error) {
        console.error('[Subscription] Failed to get trial info:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Create Stripe Checkout session handler
 * Uses Edge Functions when STRIPE_SECRET_KEY is not available (production mode)
 */
async function handleCreateCheckout(
    event: Electron.IpcMainInvokeEvent,
    plan: SubscriptionPlan,
    email: string
): Promise<{
    success: boolean;
    checkoutUrl?: string;
    error?: string;
}> {
    try {
        console.log('[Subscription] Creating checkout session:', { plan, email });

        // Determine if we should use Edge Functions (production) or direct Stripe (development)
        const useEdgeFunctions = !process.env.STRIPE_SECRET_KEY;

        if (useEdgeFunctions) {
            // Use Edge Functions (recommended for production)
            console.log('[Subscription] Using Edge Functions for checkout');
            const edgeClient = getEdgeFunctionClient();
            const priceType = plan === SubscriptionPlan.WORKPLACE_YEARLY ? 'yearly' : 'monthly';

            const checkoutSession = await edgeClient.createCheckoutSession(priceType);

            // Open checkout URL in default browser
            await shell.openExternal(checkoutSession.url);

            console.log('[Subscription] Checkout session created via Edge Function');
            return {
                success: true,
                checkoutUrl: checkoutSession.url,
            };
        } else {
            // Legacy: Use direct Stripe API (development only)
            console.log('[Subscription] Using direct Stripe API for checkout (development mode)');

            if (!subscriptionValidator) {
                throw new Error('Subscription validator not initialized');
            }

            const stripeClient = subscriptionValidator.getStripeClient();

            // Get or create Stripe customer
            const deviceFingerprint = await DeviceFingerprintService.generate();
            const customer = await stripeClient.getOrCreateCustomer(email, {
                deviceId: deviceFingerprint.deviceId,
                deviceName: deviceFingerprint.deviceName,
                platform: deviceFingerprint.platform,
                osVersion: deviceFingerprint.osVersion,
                lastSeenAt: Date.now(),
                registeredAt: Date.now(),
            });

            // Map plan to Stripe Price ID
            const priceIdMap: Record<SubscriptionPlan, string> = {
                [SubscriptionPlan.FREE]: '',
                [SubscriptionPlan.WORKPLACE_MONTHLY]: process.env.STRIPE_PRICE_WORKPLACE_MONTHLY || '',
                [SubscriptionPlan.WORKPLACE_YEARLY]: process.env.STRIPE_PRICE_WORKPLACE_YEARLY || '',
            };

            const priceId = priceIdMap[plan];
            if (!priceId) {
                throw new Error(`No Stripe Price ID configured for plan: ${plan}`);
            }

            // Create checkout session
            const checkoutSession = await stripeClient.createCheckoutSession(
                email,
                priceId,
                customer.id
            );

            // Open checkout URL in default browser
            await shell.openExternal(checkoutSession.url);

            console.log('[Subscription] Checkout session created:', checkoutSession.sessionId);
            return {
                success: true,
                checkoutUrl: checkoutSession.url,
            };
        }
    } catch (error) {
        console.error('[Subscription] Failed to create checkout:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Open Stripe Customer Portal handler
 * Uses Edge Functions when STRIPE_SECRET_KEY is not available (production mode)
 */
async function handleOpenCustomerPortal(): Promise<{
    success: boolean;
    portalUrl?: string;
    error?: string;
}> {
    try {
        console.log('[Subscription] Opening customer portal');

        // Determine if we should use Edge Functions (production) or direct Stripe (development)
        const useEdgeFunctions = !process.env.STRIPE_SECRET_KEY;

        if (useEdgeFunctions) {
            // Use Edge Functions (recommended for production)
            console.log('[Subscription] Using Edge Functions for portal');
            const edgeClient = getEdgeFunctionClient();
            const portalSession = await edgeClient.createCustomerPortalSession('timeportal://settings');

            // Open portal URL in default browser
            await shell.openExternal(portalSession.url);

            console.log('[Subscription] Customer portal opened via Edge Function');
            return {
                success: true,
                portalUrl: portalSession.url,
            };
        } else {
            // Legacy: Use direct Stripe API (development only)
            console.log('[Subscription] Using direct Stripe API for portal (development mode)');

            if (!subscriptionValidator) {
                throw new Error('Subscription validator not initialized');
            }

            const subscription = await SubscriptionStorage.getSubscription();

            if (!subscription || !subscription.stripeCustomerId) {
                throw new Error('No active subscription found');
            }

            const stripeClient = subscriptionValidator.getStripeClient();
            const portalSession = await stripeClient.createCustomerPortalSession(
                subscription.stripeCustomerId
            );

            // Open portal URL in default browser
            await shell.openExternal(portalSession.url);

            console.log('[Subscription] Customer portal opened');
            return {
                success: true,
                portalUrl: portalSession.url,
            };
        }
    } catch (error) {
        console.error('[Subscription] Failed to open customer portal:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Subscribe with email handler (creates customer and starts checkout)
 */
async function handleSubscribe(
    event: Electron.IpcMainInvokeEvent,
    email: string,
    plan: SubscriptionPlan
): Promise<{
    success: boolean;
    checkoutUrl?: string;
    error?: string;
}> {
    try {
        console.log('[Subscription] Starting subscription flow:', { email, plan });

        // Use the checkout handler
        return await handleCreateCheckout(event, plan, email);
    } catch (error) {
        console.error('[Subscription] Subscribe failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Cancel subscription handler
 */
async function handleCancelSubscription(): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        console.log('[Subscription] Canceling subscription...');

        // For Stripe, cancellation is handled through Customer Portal
        // This is a safer approach as it goes through Stripe's UI
        return await handleOpenCustomerPortal();
    } catch (error) {
        console.error('[Subscription] Cancel failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get subscription validator instance (for internal use)
 */
export function getSubscriptionValidator(): SubscriptionValidator | null {
    return subscriptionValidator;
}

/**
 * Cleanup subscription system resources
 * Should be called before app quits to ensure clean shutdown
 */
export async function cleanupSubscription(): Promise<void> {
    console.log('[Subscription] Cleaning up subscription system...');

    try {
        // Stop webhook server if running
        if (webhookServer) {
            await webhookServer.stop();
            webhookServer = null;
            console.log('[Subscription] Webhook server stopped');
        }

        // Cleanup trial notifications interval
        cleanupTrialNotifications();

        console.log('[Subscription] Subscription system cleanup completed');
    } catch (error) {
        console.error('[Subscription] Error during cleanup:', error);
    }
}
