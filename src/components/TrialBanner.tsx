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

    // Color scheme based on urgency
    const bgColor = isCritical
        ? 'bg-red-900/40'
        : isUrgent
        ? 'bg-orange-900/40'
        : 'bg-blue-900/40';

    const borderColor = isCritical
        ? 'border-red-700'
        : isUrgent
        ? 'border-orange-700'
        : 'border-blue-700';

    const textColor = isCritical
        ? 'text-red-300'
        : isUrgent
        ? 'text-orange-300'
        : 'text-blue-300';

    const iconColor = isCritical
        ? 'text-red-400'
        : isUrgent
        ? 'text-orange-400'
        : 'text-blue-400';

    const buttonColor = isCritical
        ? 'bg-red-600 hover:bg-red-500'
        : isUrgent
        ? 'bg-orange-600 hover:bg-orange-500'
        : 'bg-blue-600 hover:bg-blue-500';

    return (
        <div className={`${bgColor} border ${borderColor} rounded-lg p-3 mb-3`}>
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
                    <h4 className={`text-sm font-medium ${textColor} mb-1`}>
                        {isCritical
                            ? `Trial Ending ${subscription.trialDaysRemaining === 0 ? 'Today' : 'Tomorrow'}!`
                            : isUrgent
                            ? `Trial Ending in ${subscription.trialDaysRemaining} Days`
                            : `${subscription.trialDaysRemaining} Days Left in Trial`}
                    </h4>
                    <p className={`text-xs ${textColor}/80 mb-3`}>
                        {isCritical
                            ? 'Your trial is about to expire. Upgrade now to keep access to Jira, Tempo, and AI features.'
                            : isUrgent
                            ? 'Your trial is ending soon. Upgrade to Workplace Plan to continue using premium features.'
                            : 'You are currently enjoying full access to all Workplace Plan features. Upgrade before your trial ends to keep them.'}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUpgrade}
                            disabled={isUpgrading}
                            className={`px-4 py-2 ${buttonColor} disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm rounded transition-colors font-medium`}
                        >
                            {isUpgrading ? 'Opening...' : 'Upgrade Now'}
                        </button>
                        {subscription.trialEndsAt && (
                            <span className={`text-xs ${textColor}/60`}>
                                Expires {new Date(subscription.trialEndsAt).toLocaleDateString()}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
