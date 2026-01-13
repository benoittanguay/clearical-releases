import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

export function TrialBanner() {
    const { subscription } = useSubscription();
    const { openCustomerPortal } = useAuth();
    const [isUpgrading, setIsUpgrading] = useState(false);

    // Don't show banner if not on trial
    if (!subscription.isTrial || subscription.trialDaysRemaining === 0) {
        return null;
    }

    const handleUpgrade = async () => {
        setIsUpgrading(true);
        const result = await openCustomerPortal();
        setIsUpgrading(false);

        if (!result.success) {
            console.error('[TrialBanner] Failed to open portal:', result.error);
        }
    };

    // Determine urgency level based on days remaining
    const isUrgent = subscription.trialDaysRemaining <= 3;
    const isCritical = subscription.trialDaysRemaining <= 1;

    // Color scheme based on urgency - using warm cream/orange theme with improved contrast
    const bgColor = isCritical
        ? 'bg-[var(--color-error-muted)]'
        : isUrgent
        ? 'bg-[var(--color-warning-muted)]'
        : 'bg-[#FFF5F0]'; // Warm cream with orange tint for better contrast

    const borderColor = isCritical
        ? 'border-[var(--color-error)]'
        : isUrgent
        ? 'border-[var(--color-warning)]'
        : 'border-[var(--color-accent-border)]'; // Using accent border token

    const textColor = isCritical
        ? 'text-[var(--color-error)]'
        : isUrgent
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-accent)]';

    const textSecondary = 'text-[var(--color-text-primary)]'; // Better contrast with darker text

    const iconColor = isCritical
        ? 'text-[var(--color-error)]'
        : isUrgent
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-accent)]';

    const buttonColor = isCritical
        ? 'bg-[var(--color-error)] hover:bg-[var(--color-error)]/90'
        : isUrgent
        ? 'bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90'
        : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'; // Using design system hover state

    return (
        <div className={`${bgColor} border ${borderColor} rounded-xl p-3 mb-3 transition-all duration-200`}>
            <div className="flex items-start gap-3">
                <svg
                    className={`w-5 h-5 ${iconColor} flex-shrink-0 mt-0.5`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    {isCritical || isUrgent ? (
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    ) : (
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    )}
                </svg>
                <div className="flex-1">
                    <h4 className={`text-sm font-semibold ${textColor} mb-1 font-[var(--font-display)]`}>
                        {isCritical
                            ? `Trial Ending ${subscription.trialDaysRemaining === 0 ? 'Today' : 'Tomorrow'}!`
                            : isUrgent
                            ? `Trial Ending in ${subscription.trialDaysRemaining} Days`
                            : `${subscription.trialDaysRemaining} Days Left in Trial`}
                    </h4>
                    <p className={`text-xs ${textSecondary} mb-3`}>
                        {isCritical
                            ? 'Your trial is about to expire. Upgrade now to keep access to Jira, Tempo, and AI features.'
                            : isUrgent
                            ? 'Your trial is ending soon. Upgrade to Workplace Plan to continue using premium features.'
                            : 'You are currently enjoying full access to all Workplace Plan features. Upgrade before your trial ends to keep them.'}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleUpgrade}
                            disabled={isUpgrading}
                            className={`px-4 py-2 ${buttonColor} disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-all font-medium`}
                        >
                            {isUpgrading ? 'Opening...' : 'Upgrade Now'}
                        </button>
                        {subscription.trialEndsAt && (
                            <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
                                Expires {new Date(subscription.trialEndsAt).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
