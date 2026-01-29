import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useJiraCache } from '../context/JiraCacheContext';
import { AppBlacklistManager } from './AppBlacklistManager';
import { getTimeIncrementOptions } from '../utils/timeRounding';
import { analytics } from '../services/analytics';
import type { SyncStatus } from '../services/jiraSyncScheduler';
import type { UpdateStatus } from '../types/electron';

type PermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'stale';

interface SettingsProps {
    onOpenJiraModal?: () => void;
    onOpenTempoModal?: () => void;
}

export function Settings({ onOpenJiraModal, onOpenTempoModal }: SettingsProps = {}) {
    const { settings, updateSettings, resetSettings } = useSettings();
    const { subscription, hasFeature, upgrade, openCustomerPortal } = useSubscription();
    const { user, signOut } = useAuth();
    const jiraCache = useJiraCache();
    const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
    const [tempSettings, setTempSettings] = useState(settings);
    const [saveTimeoutId, setSaveTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isOpeningPortal, setIsOpeningPortal] = useState(false);
    const [appVersion, setAppVersion] = useState<string>('');
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
    const [calendarConnected, setCalendarConnected] = useState(false);
    const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
    const [calendarLoading, setCalendarLoading] = useState(true);
    const [calendarConnecting, setCalendarConnecting] = useState(false);

    const handleOpenJiraModal = () => {
        if (onOpenJiraModal) {
            onOpenJiraModal();
        }
    };

    const handleOpenTempoModal = () => {
        if (onOpenTempoModal) {
            onOpenTempoModal();
        }
    };

    // Check calendar connection status
    const checkCalendarConnection = async () => {
        setCalendarLoading(true);
        try {
            const result = await window.electron.ipcRenderer.calendar.isConnected();
            if (result.success) {
                setCalendarConnected(result.connected);
                if (result.connected) {
                    const accountResult = await window.electron.ipcRenderer.calendar.getAccount();
                    if (accountResult.success) {
                        setCalendarEmail(accountResult.email);
                    }
                }
            }
        } catch (err) {
            console.error('[Settings] Failed to check calendar connection:', err);
        } finally {
            setCalendarLoading(false);
        }
    };

    const handleCalendarConnect = async () => {
        setCalendarConnecting(true);
        try {
            analytics.track('calendar.connect_initiated');
            const result = await window.electron.ipcRenderer.calendar.connect();
            if (result.success) {
                analytics.track('calendar.connect_success');
                await checkCalendarConnection();
            } else {
                analytics.track('calendar.connect_failed', { error: result.error });
            }
        } catch (err) {
            console.error('[Settings] Failed to connect calendar:', err);
            analytics.track('calendar.connect_error', { error: String(err) });
        } finally {
            setCalendarConnecting(false);
        }
    };

    const handleCalendarDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect your Google Calendar?')) {
            return;
        }
        setCalendarConnecting(true);
        try {
            analytics.track('calendar.disconnect_initiated');
            const result = await window.electron.ipcRenderer.calendar.disconnect();
            if (result.success) {
                analytics.track('calendar.disconnect_success');
                setCalendarConnected(false);
                setCalendarEmail(null);
            }
        } catch (err) {
            console.error('[Settings] Failed to disconnect calendar:', err);
        } finally {
            setCalendarConnecting(false);
        }
    };

    const checkPermission = async () => {
        // @ts-ignore - window.electron is defined in preload
        if (window.electron) {
            // @ts-ignore
            const status = await window.electron.ipcRenderer.invoke('check-screen-permission');
            setPermissionStatus(status);
        }
    };

    const openSettings = async () => {
        // @ts-ignore
        if (window.electron) {
            // @ts-ignore
            await window.electron.ipcRenderer.invoke('open-screen-permission-settings');
        }
    };

    useEffect(() => {
        checkPermission();
        // Poll every few seconds in case user changed it
        const interval = setInterval(checkPermission, 2000);
        return () => clearInterval(interval);
    }, []);

    // Check calendar connection on mount
    useEffect(() => {
        checkCalendarConnection();
    }, []);

    // Get app version and update status on mount
    useEffect(() => {
        const getVersionAndUpdateStatus = async () => {
            // Get version from Electron app
            try {
                const envInfo = await window.electron.ipcRenderer.getEnvironmentInfo();
                setAppVersion(envInfo.version);
            } catch (error) {
                console.error('[Settings] Failed to load version:', error);
                setAppVersion('Unknown');
            }

            // Get current update status
            try {
                const result = await window.electron.ipcRenderer.updater.getStatus();
                if (result.success && result.status) {
                    setUpdateStatus(result.status);
                }
            } catch (error) {
                console.error('[Settings] Failed to get update status:', error);
            }
        };

        getVersionAndUpdateStatus();

        // Subscribe to update status changes
        const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate((status) => {
            setUpdateStatus(status);
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    // Update tempSettings when settings change
    useEffect(() => {
        setTempSettings(settings);
    }, [settings]);

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds}s`;
        const minutes = seconds / 60;
        return `${minutes}m`;
    };

    const parseDurationInput = (input: string): number => {
        const trimmed = input.toLowerCase().trim();
        
        // Handle milliseconds
        if (trimmed.endsWith('ms')) {
            return parseInt(trimmed.slice(0, -2)) || 0;
        }
        
        // Handle seconds
        if (trimmed.endsWith('s')) {
            return (parseFloat(trimmed.slice(0, -1)) * 1000) || 0;
        }
        
        // Handle minutes
        if (trimmed.endsWith('m')) {
            return (parseFloat(trimmed.slice(0, -1)) * 60 * 1000) || 0;
        }
        
        // Default to milliseconds if no unit
        return parseInt(trimmed) || 0;
    };

    // Auto-save function with debouncing
    const autoSave = () => {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }
        
        const timeoutId = setTimeout(() => {
            updateSettings(tempSettings);
        }, 500); // 500ms debounce
        
        setSaveTimeoutId(timeoutId);
    };

    // Auto-save when tempSettings changes
    useEffect(() => {
        // Only auto-save if the values are different from the original settings
        if (JSON.stringify(tempSettings) !== JSON.stringify(settings)) {
            autoSave();
        }
        
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, [tempSettings]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, []);

    // Load analytics preference
    useEffect(() => {
        const loadAnalyticsPreference = async () => {
            try {
                const result = await window.electron.analytics.getEnabled();
                if (result.success) {
                    setAnalyticsEnabled(result.enabled);
                }
            } catch (error) {
                console.error('[Settings] Failed to load analytics preference:', error);
            }
        };
        loadAnalyticsPreference();
    }, []);

    // Track when settings is opened
    useEffect(() => {
        analytics.track('settings.opened');
    }, []);

    const handleAnalyticsToggle = async (enabled: boolean) => {
        setAnalyticsEnabled(enabled);
        try {
            await window.electron.analytics.setEnabled(enabled);
            // Update the analytics service
            const { analytics } = await import('../services/analytics');
            analytics.setEnabled(enabled);
        } catch (error) {
            console.error('[Settings] Failed to save analytics preference:', error);
            // Revert on error
            setAnalyticsEnabled(!enabled);
        }
    };

    // Subscribe to sync status updates
    useEffect(() => {
        const unsubscribe = jiraCache.onSyncStatusUpdate((status) => {
            setSyncStatus(status);
            setIsSyncing(status.isSyncing);

            // Update last sync timestamp in settings when sync completes
            if (!status.isSyncing && status.lastSyncTimestamp > 0) {
                const currentLastSync = settings.jira?.lastSyncTimestamp || 0;
                if (status.lastSyncTimestamp > currentLastSync) {
                    updateSettings({
                        jira: {
                            ...settings.jira,
                            lastSyncTimestamp: status.lastSyncTimestamp,
                        },
                    });
                }
            }
        });

        return () => unsubscribe();
    }, [jiraCache, settings.jira, updateSettings]);

    // Handle manual sync
    const handleSyncNow = async () => {
        try {
            setIsSyncing(true);
            await jiraCache.syncNow();
        } catch (error) {
            console.error('[Settings] Manual sync failed:', error);
        } finally {
            setIsSyncing(false);
        }
    };

    // Format timestamp for display
    const formatSyncTime = (timestamp: number): string => {
        if (timestamp === 0) return 'Never';

        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (60 * 1000));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    };

    // Format next sync time
    const formatNextSyncTime = (timestamp: number | null): string => {
        if (!timestamp) return 'Not scheduled';

        const now = Date.now();
        const diff = timestamp - now;

        if (diff <= 0) return 'Soon';

        const minutes = Math.floor(diff / (60 * 1000));
        const hours = Math.floor(minutes / 60);

        if (minutes < 1) return 'Soon';
        if (minutes < 60) return `in ${minutes}m`;
        return `in ${hours}h ${minutes % 60}m`;
    };

    const handleResetSettings = () => {
        resetSettings();
    };

    // Handle upgrade button click - opens Stripe Checkout
    const handleUpgrade = async () => {
        if (!user?.email) {
            console.error('[Settings] No user email available');
            return;
        }

        setIsOpeningPortal(true);

        const result = await upgrade(user.email);

        setIsOpeningPortal(false);

        if (!result.success) {
            console.error('[Settings] Failed to start upgrade:', result.error);
            alert(`Failed to start upgrade: ${result.error}`);
        }
    };

    // Handle manage subscription button click - opens Stripe Customer Portal
    const handleOpenPortal = async () => {
        setIsOpeningPortal(true);

        const result = await openCustomerPortal();

        setIsOpeningPortal(false);

        if (!result.success) {
            console.error('[Settings] Failed to open customer portal:', result.error);
            alert(`Failed to open customer portal: ${result.error}`);
        }
    };

    // Handle sign out
    const handleSignOut = async () => {
        if (confirm('Are you sure you want to sign out?')) {
            await signOut();
        }
    };

    // Handle manual update check
    const handleCheckForUpdates = async () => {
        setIsCheckingUpdate(true);
        try {
            const result = await window.electron.ipcRenderer.updater.checkForUpdates();
            if (result.success && result.status) {
                setUpdateStatus(result.status);
                // If no update available, show a message
                if (!result.status.available) {
                    alert('You are running the latest version!');
                }
            }
        } catch (error) {
            console.error('[Settings] Failed to check for updates:', error);
            alert('Failed to check for updates. Please try again later.');
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    const hasJiraAccess = hasFeature('jira');
    const hasTempoAccess = hasFeature('tempo');

    return (
        <div className="w-full flex-1 flex flex-col px-4 pb-4">
            {/* Account & Subscription */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)] transition-all duration-200 hover:border-[var(--color-border-primary)]/60 mt-3">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider font-display">Account</h3>
                    <div className="flex items-center gap-2">
                        {subscription.isTrial && (
                            <button
                                onClick={handleUpgrade}
                                disabled={isOpeningPortal}
                                className="px-3 py-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-xs rounded-lg transition-all font-medium"
                            >
                                {isOpeningPortal ? 'Opening...' : 'Upgrade'}
                            </button>
                        )}
                        {!subscription.isTrial && subscription.tier === 'workplace' && subscription.isActive && (
                            <button
                                onClick={handleOpenPortal}
                                disabled={isOpeningPortal}
                                className="px-3 py-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-xs rounded-lg transition-all font-medium"
                            >
                                {isOpeningPortal ? 'Opening...' : 'Manage'}
                            </button>
                        )}
                        {!subscription.isTrial && subscription.tier === 'free' && (
                            <button
                                onClick={handleUpgrade}
                                disabled={isOpeningPortal}
                                className="px-3 py-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-xs rounded-lg transition-all font-medium"
                            >
                                {isOpeningPortal ? 'Opening...' : 'Upgrade'}
                            </button>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)]"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
                <div className="space-y-2.5">
                    {/* User info */}
                    <div className="bg-[var(--color-bg-tertiary)] p-3 rounded-xl border border-[var(--color-border-primary)] transition-all duration-200 hover:border-[var(--color-accent)]/20">
                        <div className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{user?.email || 'Unknown'}</div>
                        <div className="text-xs text-[var(--color-text-secondary)] font-mono">
                            {subscription.isTrial && (
                                <>
                                    <span className="text-[var(--color-info)] font-semibold">TRIAL</span>
                                    <span className="mx-1.5">·</span>
                                    <span>{subscription.trialDaysRemaining} days remaining</span>
                                </>
                            )}
                            {!subscription.isTrial && subscription.tier === 'workplace' && subscription.isActive && (
                                <span>Premium</span>
                            )}
                            {!subscription.isTrial && subscription.tier === 'free' && (
                                <span>Free Plan</span>
                            )}
                        </div>
                    </div>

                    {/* User role input */}
                    <div>
                        <label className="block text-xs text-[var(--color-text-secondary)] font-medium mb-1.5">
                            Your Role
                        </label>
                        <input
                            type="text"
                            value={tempSettings.ai?.userRole || ''}
                            onChange={(e) => {
                                setTempSettings(prev => ({
                                    ...prev,
                                    ai: {
                                        ...prev.ai,
                                        autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                        autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                        autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                        autoRecordMeetings: prev.ai?.autoRecordMeetings ?? true,
                                        userRole: e.target.value,
                                    }
                                }));
                            }}
                            placeholder="e.g. Software Developer, Product Manager, Designer"
                            className="w-full border text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                            style={{
                                backgroundColor: 'var(--color-bg-primary)',
                                borderColor: 'var(--color-border-primary)',
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-body)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#8c877d';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                            }}
                        />
                        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1">
                            Helps AI generate more relevant activity descriptions
                        </p>
                    </div>

                    {/* Upgrade prompt for free users (not on trial) */}
                    {subscription.tier === 'free' && !subscription.isTrial && (
                        <div className="bg-[var(--color-info-muted)] border border-[var(--color-info)] rounded-xl p-3">
                            <div className="flex items-start gap-3">
                                <svg className="w-5 h-5 text-[var(--color-info)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <div className="flex-1">
                                    <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Upgrade to Premium</h4>
                                    <p className="text-xs text-[var(--color-text-secondary)]">
                                        Unlock Jira and Tempo integrations to track time directly to your projects
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Working Hours Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">Working Hours</h3>

                <div className="space-y-3">
                    {/* Enable/Disable Toggle */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Daily Reminder</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Get prompted to start your day at a set time</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.workingHours?.enabled ?? false}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        workingHours: {
                                            ...prev.workingHours,
                                            enabled: e.target.checked,
                                            startTime: prev.workingHours?.startTime ?? '09:00',
                                            endTime: prev.workingHours?.endTime ?? '17:00',
                                            daysOfWeek: prev.workingHours?.daysOfWeek ?? [1, 2, 3, 4, 5],
                                            reminderSnoozeDuration: prev.workingHours?.reminderSnoozeDuration ?? 30,
                                            lastPromptDate: prev.workingHours?.lastPromptDate ?? null,
                                            snoozedUntil: prev.workingHours?.snoozedUntil ?? null,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                        </label>
                    </div>

                    {/* Time Settings - Only shown when enabled */}
                    {tempSettings.workingHours?.enabled && (
                        <>
                            {/* Start Time */}
                            <div className="bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-[var(--color-text-primary)]">Start Time</div>
                                        <div className="text-xs text-[var(--color-text-secondary)]">When to prompt you each working day</div>
                                    </div>
                                    <input
                                        type="time"
                                        value={tempSettings.workingHours?.startTime ?? '09:00'}
                                        onChange={(e) => {
                                            setTempSettings(prev => ({
                                                ...prev,
                                                workingHours: {
                                                    ...prev.workingHours!,
                                                    startTime: e.target.value,
                                                }
                                            }));
                                        }}
                                        className="border text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{
                                            backgroundColor: 'var(--color-bg-primary)',
                                            borderColor: 'var(--color-border-primary)',
                                            color: 'var(--color-text-primary)',
                                            fontFamily: 'var(--font-body)'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* End Time */}
                            <div className="bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-[var(--color-text-primary)]">End Time</div>
                                        <div className="text-xs text-[var(--color-text-secondary)]">Grace period ends (for late launches)</div>
                                    </div>
                                    <input
                                        type="time"
                                        value={tempSettings.workingHours?.endTime ?? '17:00'}
                                        onChange={(e) => {
                                            setTempSettings(prev => ({
                                                ...prev,
                                                workingHours: {
                                                    ...prev.workingHours!,
                                                    endTime: e.target.value,
                                                }
                                            }));
                                        }}
                                        className="border text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{
                                            backgroundColor: 'var(--color-bg-primary)',
                                            borderColor: 'var(--color-border-primary)',
                                            color: 'var(--color-text-primary)',
                                            fontFamily: 'var(--font-body)'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Working Days */}
                            <div className="bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                                <div className="text-sm font-medium text-[var(--color-text-primary)] mb-2">Working Days</div>
                                <div className="flex gap-2">
                                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => {
                                        const isSelected = tempSettings.workingHours?.daysOfWeek?.includes(index) ?? false;
                                        return (
                                            <button
                                                key={index}
                                                onClick={() => {
                                                    setTempSettings(prev => {
                                                        const currentDays = prev.workingHours?.daysOfWeek ?? [1, 2, 3, 4, 5];
                                                        const newDays = isSelected
                                                            ? currentDays.filter(d => d !== index)
                                                            : [...currentDays, index].sort((a, b) => a - b);
                                                        return {
                                                            ...prev,
                                                            workingHours: {
                                                                ...prev.workingHours!,
                                                                daysOfWeek: newDays,
                                                            }
                                                        };
                                                    });
                                                }}
                                                className={`w-8 h-8 rounded-full text-xs font-medium transition-all ${
                                                    isSelected
                                                        ? 'bg-[var(--color-accent)] text-white'
                                                        : 'bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] border border-[var(--color-border-primary)] hover:border-[var(--color-accent)]'
                                                }`}
                                            >
                                                {day}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Time Rounding Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">Time Rounding</h3>

                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-[var(--color-text-secondary)] font-medium">
                                Round Time Entries
                            </label>
                        </div>
                        <select
                            value={tempSettings.timeRoundingIncrement}
                            onChange={(e) => {
                                setTempSettings(prev => ({ ...prev, timeRoundingIncrement: parseInt(e.target.value) }));
                            }}
                            className="w-full border text-sm rounded-lg pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] cursor-pointer transition-all appearance-none"
                            style={{
                                backgroundColor: 'var(--color-bg-secondary)',
                                borderColor: 'var(--color-border-primary)',
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-body)',
                                boxShadow: 'var(--shadow-sm)',
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6560' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 12px center'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#FAF5EE';
                                e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                            }}
                        >
                            {getTimeIncrementOptions().map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <div className="text-xs text-[var(--color-text-secondary)] mt-1.5">
                            Time entries will be rounded UP to the nearest {tempSettings.timeRoundingIncrement} {tempSettings.timeRoundingIncrement === 1 ? 'minute' : 'minutes'}. This affects display and export to Tempo/Jira.
                        </div>
                    </div>
                </div>
            </div>

            {/* Activity Filtering Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider font-display">Activity Filtering</h3>
                    <button
                        onClick={handleResetSettings}
                        className="px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)]"
                    >
                        Reset to Defaults
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-[var(--color-text-secondary)] font-medium">
                                Minimum Activity Duration
                            </label>
                        </div>
                        <div className="space-y-1.5">
                            <input
                                type="text"
                                value={formatDuration(tempSettings.minActivityDuration)}
                                onChange={(e) => {
                                    const newDuration = parseDurationInput(e.target.value);
                                    setTempSettings(prev => ({ ...prev, minActivityDuration: newDuration }));
                                }}
                                className="w-full border text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                style={{
                                    backgroundColor: 'var(--color-bg-primary)',
                                    borderColor: 'var(--color-border-primary)',
                                    color: 'var(--color-text-primary)',
                                    fontFamily: 'var(--font-body)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = '#8c877d';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                }}
                                placeholder="e.g. 1s, 1000ms"
                            />
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                Activities shorter than this will be filtered unless they're near other activities from the same app
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-[var(--color-text-secondary)] font-medium">
                                Activity Gap Threshold
                            </label>
                        </div>
                        <div className="space-y-1.5">
                            <input
                                type="text"
                                value={formatDuration(tempSettings.activityGapThreshold)}
                                onChange={(e) => {
                                    const newThreshold = parseDurationInput(e.target.value);
                                    setTempSettings(prev => ({ ...prev, activityGapThreshold: newThreshold }));
                                }}
                                className="w-full border text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                style={{
                                    backgroundColor: 'var(--color-bg-primary)',
                                    borderColor: 'var(--color-border-primary)',
                                    color: 'var(--color-text-primary)',
                                    fontFamily: 'var(--font-body)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = '#8c877d';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                }}
                                placeholder="e.g. 2m, 120s"
                            />
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                Maximum time gap between same-app activities to keep short activities
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* App Exclusions / Blacklist */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">App Exclusions</h3>
                <AppBlacklistManager />
            </div>

            {/* AI Features Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">AI Features</h3>

                <div className="space-y-3">
                    {/* Auto-generate descriptions */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Auto-generate Descriptions</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Automatically create descriptions from screenshots</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoGenerateDescription ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: e.target.checked,
                                            autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                            autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                            autoRecordMeetings: prev.ai?.autoRecordMeetings ?? true,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                        </label>
                    </div>

                    {/* Auto-assign work */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Auto-assign Work</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Automatically assign entries to buckets or Jira issues</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoAssignWork ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                            autoAssignWork: e.target.checked,
                                            autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                            autoRecordMeetings: prev.ai?.autoRecordMeetings ?? true,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                        </label>
                    </div>

                    {/* Auto-select Tempo accounts */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Auto-select Tempo Accounts</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Automatically select Tempo accounts for Jira issues</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoSelectAccount ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                            autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                            autoSelectAccount: e.target.checked,
                                            autoRecordMeetings: prev.ai?.autoRecordMeetings ?? true,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                        </label>
                    </div>

                    {/* Auto-record meetings */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Auto-record Meetings</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Automatically record audio when mic/camera is in use</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoRecordMeetings ?? true}
                                onChange={(e) => {
                                    const enabled = e.target.checked;
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                            autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                            autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                            autoRecordMeetings: enabled,
                                        }
                                    }));
                                    // Notify main process of the setting change
                                    window.electron?.ipcRenderer?.meeting?.setAutoRecordEnabled(enabled);
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Time Tracking Integration Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider font-display">Time Tracking Integration</h3>
                    {!hasJiraAccess && !hasTempoAccess && (
                        <span className="text-[10px] px-2 py-1 bg-[var(--color-warning-muted)] text-[var(--color-warning)] rounded-full font-semibold font-mono tracking-wide">
                            PREMIUM
                        </span>
                    )}
                </div>

                <div className="space-y-2">
                    {/* Jira Status */}
                    <div className={`flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)] ${!hasJiraAccess ? 'opacity-60' : ''}`}>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                    Jira
                                </div>
                                {!hasJiraAccess && (
                                    <svg className="w-4 h-4 text-[var(--color-warning)]" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </div>
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                {!hasJiraAccess
                                    ? 'Requires Premium'
                                    : tempSettings.jira?.enabled
                                        ? `Connected to ${tempSettings.jira.baseUrl?.replace('https://', '') || 'Jira instance'}`
                                        : 'Integration disabled'
                                }
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold font-mono tracking-wide ${
                                hasJiraAccess && tempSettings.jira?.enabled && tempSettings.jira?.apiToken && tempSettings.jira?.baseUrl && tempSettings.jira?.email
                                    ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                                    : 'bg-[var(--color-bg-quaternary)] text-[var(--color-text-tertiary)]'
                            }`}>
                                {hasJiraAccess && tempSettings.jira?.enabled && tempSettings.jira?.apiToken && tempSettings.jira?.baseUrl && tempSettings.jira?.email ? 'CONNECTED' : 'DISABLED'}
                            </span>
                            {hasJiraAccess && (
                                <button
                                    onClick={handleOpenJiraModal}
                                    className="px-3 py-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs rounded-lg transition-all"
                                >
                                    Configure
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tempo Status */}
                    <div className={`flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)] ${!hasTempoAccess ? 'opacity-60' : ''}`}>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                    Tempo
                                </div>
                                {!hasTempoAccess && (
                                    <svg className="w-4 h-4 text-[var(--color-warning)]" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </div>
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                {!hasTempoAccess
                                    ? 'Requires Premium'
                                    : tempSettings.tempo?.enabled
                                        ? `Connected to ${tempSettings.tempo.baseUrl?.includes('eu') ? 'EU' : 'Global'} region`
                                        : 'Integration disabled'
                                }
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold font-mono tracking-wide ${
                                hasTempoAccess && tempSettings.tempo?.enabled && tempSettings.tempo?.apiToken
                                    ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                                    : 'bg-[var(--color-bg-quaternary)] text-[var(--color-text-tertiary)]'
                            }`}>
                                {hasTempoAccess && tempSettings.tempo?.enabled && tempSettings.tempo?.apiToken ? 'CONNECTED' : 'DISABLED'}
                            </span>
                            {hasTempoAccess && (
                                <button
                                    onClick={handleOpenTempoModal}
                                    className="px-3 py-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs rounded-lg transition-all"
                                >
                                    Configure
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Google Calendar Status */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div className="flex-1">
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                Google Calendar
                            </div>
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                {calendarLoading
                                    ? 'Checking connection...'
                                    : calendarConnected
                                        ? calendarEmail || 'Connected'
                                        : 'Integration disabled'
                                }
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold font-mono tracking-wide ${
                                calendarConnected
                                    ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                                    : 'bg-[var(--color-bg-quaternary)] text-[var(--color-text-tertiary)]'
                            }`}>
                                {calendarConnected ? 'CONNECTED' : 'DISABLED'}
                            </span>
                            {calendarConnected ? (
                                <button
                                    onClick={handleCalendarDisconnect}
                                    disabled={calendarConnecting}
                                    className="px-3 py-1 bg-[var(--color-error)] hover:bg-[var(--color-error)]/90 disabled:opacity-50 text-white text-xs rounded-lg transition-all"
                                >
                                    {calendarConnecting ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                            ) : (
                                <button
                                    onClick={handleCalendarConnect}
                                    disabled={calendarConnecting || calendarLoading}
                                    className="px-3 py-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 text-white text-xs rounded-lg transition-all"
                                >
                                    {calendarConnecting ? 'Connecting...' : 'Connect'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Upgrade Button (only shown when user has no access) */}
                    {!hasJiraAccess && !hasTempoAccess && (
                        <button
                            onClick={handleUpgrade}
                            disabled={isOpeningPortal}
                            className="w-full px-3 py-1.5 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 disabled:opacity-50 text-white text-sm rounded-lg transition-all flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                            {isOpeningPortal ? 'Opening...' : 'Upgrade to Premium'}
                        </button>
                    )}
                </div>
            </div>


            {/* Jira Sync Settings */}
            {hasJiraAccess && tempSettings.jira?.enabled && tempSettings.jira?.apiToken && (
                <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                    <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">Jira Sync Settings</h3>

                    <div className="space-y-3">
                        {/* Auto-sync toggle */}
                        <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                            <div>
                                <div className="text-sm font-medium text-[var(--color-text-primary)]">Automatic Sync</div>
                                <div className="text-xs text-[var(--color-text-secondary)]">Periodically sync Jira data in background</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={tempSettings.jira?.autoSync ?? true}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({
                                            ...prev,
                                            jira: {
                                                ...prev.jira,
                                                autoSync: e.target.checked,
                                            }
                                        }));
                                    }}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                            </label>
                        </div>

                        {/* Sync interval selector */}
                        {tempSettings.jira?.autoSync && (
                            <div className="bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                                    Sync Interval
                                </label>
                                <select
                                    value={tempSettings.jira?.syncInterval || 30}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({
                                            ...prev,
                                            jira: {
                                                ...prev.jira,
                                                syncInterval: parseInt(e.target.value),
                                            }
                                        }));
                                    }}
                                    className="w-full border text-sm rounded-lg pl-4 pr-10 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] cursor-pointer transition-all appearance-none"
                                    style={{
                                        backgroundColor: 'var(--color-bg-secondary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-body)',
                                        boxShadow: 'var(--shadow-sm)',
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6560' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 12px center'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#FAF5EE';
                                        e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                    }}
                                >
                                    <option value={15}>Every 15 minutes</option>
                                    <option value={30}>Every 30 minutes</option>
                                    <option value={60}>Every hour</option>
                                    <option value={120}>Every 2 hours</option>
                                </select>
                            </div>
                        )}

                        {/* Sync status */}
                        {syncStatus && (
                            <div className="bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm font-medium text-[var(--color-text-primary)]">Sync Status</div>
                                    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold font-mono tracking-wide ${
                                        isSyncing ? 'bg-[var(--color-info-muted)] text-[var(--color-info)]' :
                                        syncStatus.lastSyncError ? 'bg-[var(--color-error-muted)] text-[var(--color-error)]' :
                                        'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                                    }`}>
                                        {isSyncing ? 'SYNCING...' :
                                         syncStatus.lastSyncError ? 'ERROR' :
                                         'READY'}
                                    </span>
                                </div>
                                <div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                                    <div className="flex justify-between">
                                        <span>Last sync:</span>
                                        <span className="text-[var(--color-text-primary)]">{formatSyncTime(syncStatus.lastSyncTimestamp)}</span>
                                    </div>
                                    {syncStatus.isEnabled && syncStatus.nextSyncTimestamp && (
                                        <div className="flex justify-between">
                                            <span>Next sync:</span>
                                            <span className="text-[var(--color-text-primary)]">{formatNextSyncTime(syncStatus.nextSyncTimestamp)}</span>
                                        </div>
                                    )}
                                    {syncStatus.lastSyncError && (
                                        <div className="text-[var(--color-error)] mt-1">
                                            Error: {syncStatus.lastSyncError}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Manual sync button */}
                        <button
                            onClick={handleSyncNow}
                            disabled={isSyncing}
                            className={`w-full px-3 py-2 text-sm rounded-lg transition-all ${
                                isSyncing
                                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] cursor-not-allowed'
                                    : 'bg-[var(--color-success)] hover:bg-[var(--color-success)]/90 text-white'
                            }`}
                        >
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">Permissions</h3>
                <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                    <div className="flex-1">
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">Screen Recording</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">Required for screenshots</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-1 rounded-full font-semibold font-mono tracking-wide ${
                            permissionStatus === 'granted' ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]' :
                            permissionStatus === 'denied' ? 'bg-[var(--color-error-muted)] text-[var(--color-error)]' :
                            permissionStatus === 'stale' ? 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]' :
                            'bg-[var(--color-warning-muted)] text-[var(--color-warning)]'
                        }`}>
                            {permissionStatus === 'stale' ? 'NEEDS RESET' : permissionStatus.toUpperCase()}
                        </span>
                        {permissionStatus !== 'granted' && permissionStatus !== 'stale' && (
                            <button
                                onClick={openSettings}
                                className="px-3 py-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs rounded-lg transition-all"
                            >
                                Open Settings
                            </button>
                        )}
                    </div>
                </div>

                {/* Stale Permission Warning */}
                {permissionStatus === 'stale' && (
                    <div className="mt-2 bg-[var(--color-warning-muted)] border border-[var(--color-warning)] rounded-xl p-3">
                        <div className="flex items-start gap-3 mb-3">
                            <svg className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                                <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Permission Needs Reset</h4>
                                <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                                    After updating the app, macOS may have stale permission entries. System Settings shows the permission is granted, but it doesn't actually work.
                                </p>
                                <p className="text-xs text-[var(--color-text-secondary)] font-medium">
                                    This is a known macOS issue with app updates. Your data is safe.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                // @ts-ignore
                                if (window.electron?.ipcRenderer?.showPermissionResetInstructions) {
                                    // @ts-ignore
                                    await window.electron.ipcRenderer.showPermissionResetInstructions();
                                    // Recheck after showing instructions
                                    setTimeout(checkPermission, 1000);
                                }
                            }}
                            className="w-full px-4 py-2 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 text-white text-sm font-semibold rounded-lg transition-all"
                        >
                            Fix Permission Issue
                        </button>
                    </div>
                )}
            </div>

            {/* App Version & Updates */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider font-display">App Version & Updates</h3>
                    <button
                        onClick={handleCheckForUpdates}
                        disabled={isCheckingUpdate}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 font-medium ${
                            isCheckingUpdate
                                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] cursor-not-allowed'
                                : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white'
                        }`}
                    >
                        {isCheckingUpdate ? (
                            <>
                                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Checking...
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Check for Updates
                            </>
                        )}
                    </button>
                </div>

                <div className="space-y-2">
                    {/* Current Version */}
                    <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                        <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">Current Version</div>
                            <div className="text-xs text-[var(--color-text-secondary)]">Clearical</div>
                        </div>
                        <span className="text-sm font-mono text-[var(--color-success)]">
                            v{appVersion || '...'}
                        </span>
                    </div>

                    {/* Update Status */}
                    {updateStatus && updateStatus.available && (
                        <div className="bg-[var(--color-info-muted)] border border-[var(--color-info)] rounded-xl p-2.5">
                            <div className="flex items-start gap-2">
                                <svg className="w-4 h-4 text-[var(--color-info)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-[var(--color-text-primary)] mb-0.5">
                                        Update Available
                                    </div>
                                    <div className="text-xs text-[var(--color-text-secondary)]">
                                        Version {updateStatus.version} is available for download
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Update error message */}
                    {updateStatus?.error && (
                        <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-xl p-2.5">
                            <div className="text-xs text-[var(--color-error)]">
                                {updateStatus.error}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Privacy Settings */}
            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3 font-display">Privacy</h3>
                <div className="flex items-center justify-between bg-[var(--color-bg-tertiary)] p-2.5 rounded-lg border border-[var(--color-border-primary)]">
                    <div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">Help improve Clearical</div>
                        <div className="text-xs text-[var(--color-text-secondary)]">Send anonymous usage data to help us improve the app</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={analyticsEnabled}
                            onChange={(e) => handleAnalyticsToggle(e.target.checked)}
                            className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-[var(--color-border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--color-success)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--color-border-primary)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-success)]"></div>
                    </label>
                </div>
            </div>

            <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl border border-[var(--color-border-primary)]">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 font-display">About</h3>
                <p className="text-xs text-[var(--color-text-secondary)]">
                    Clearical is an intelligent time tracking application that helps you log and manage your work activities.
                </p>
            </div>
        </div>
    );
}
