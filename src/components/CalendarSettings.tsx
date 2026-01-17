import { useState, useEffect } from 'react';
import { analytics } from '../services/analytics';

interface CalendarAccount {
    email: string | null;
    provider: string | null;
}

export function CalendarSettings() {
    const [isConnected, setIsConnected] = useState(false);
    const [account, setAccount] = useState<CalendarAccount>({ email: null, provider: null });
    const [isLoading, setIsLoading] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check connection status on mount
    useEffect(() => {
        checkConnectionStatus();
    }, []);

    // Track when calendar settings is viewed
    useEffect(() => {
        analytics.track('calendar_settings.viewed');
    }, []);

    const checkConnectionStatus = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const result = await window.electron.ipcRenderer.calendar.isConnected();

            if (result.success) {
                setIsConnected(result.connected);

                // If connected, fetch account info
                if (result.connected) {
                    const accountResult = await window.electron.ipcRenderer.calendar.getAccount();
                    if (accountResult.success) {
                        setAccount({
                            email: accountResult.email,
                            provider: accountResult.provider,
                        });
                    }
                }
            } else {
                setError(result.error || 'Failed to check connection status');
            }
        } catch (err) {
            console.error('[CalendarSettings] Failed to check connection:', err);
            setError('Failed to check connection status');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setError(null);

        try {
            analytics.track('calendar.connect_initiated');
            const result = await window.electron.ipcRenderer.calendar.connect();

            if (result.success) {
                analytics.track('calendar.connect_success');
                await checkConnectionStatus();
            } else {
                analytics.track('calendar.connect_failed', { error: result.error });
                setError(result.error || 'Failed to connect to Google Calendar');
            }
        } catch (err) {
            console.error('[CalendarSettings] Failed to connect:', err);
            analytics.track('calendar.connect_error', { error: String(err) });
            setError('Failed to connect to Google Calendar');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect your Google Calendar?')) {
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            analytics.track('calendar.disconnect_initiated');
            const result = await window.electron.ipcRenderer.calendar.disconnect();

            if (result.success) {
                analytics.track('calendar.disconnect_success');
                setIsConnected(false);
                setAccount({ email: null, provider: null });
            } else {
                analytics.track('calendar.disconnect_failed', { error: result.error });
                setError(result.error || 'Failed to disconnect from Google Calendar');
            }
        } catch (err) {
            console.error('[CalendarSettings] Failed to disconnect:', err);
            analytics.track('calendar.disconnect_error', { error: String(err) });
            setError('Failed to disconnect from Google Calendar');
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSync = async () => {
        setIsSyncing(true);
        setError(null);

        try {
            analytics.track('calendar.sync_initiated');
            const result = await window.electron.ipcRenderer.calendar.sync();

            if (result.success) {
                analytics.track('calendar.sync_success');
            } else {
                analytics.track('calendar.sync_failed', { error: result.error });
                setError(result.error || 'Failed to sync calendar');
            }
        } catch (err) {
            console.error('[CalendarSettings] Failed to sync:', err);
            analytics.track('calendar.sync_error', { error: String(err) });
            setError('Failed to sync calendar');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="bg-[var(--color-bg-secondary)] p-4 rounded-2xl mb-3 border border-[var(--color-border-primary)] transition-all duration-200 hover:border-[var(--color-border-primary)]/60">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider font-[var(--font-display)]">
                    Google Calendar
                </h3>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-6">
                    <svg className="animate-spin h-6 w-6 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)] rounded-xl p-3 mb-3">
                    <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-[var(--color-error)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="text-xs text-[var(--color-error)]">
                            {error}
                        </div>
                    </div>
                </div>
            )}

            {/* Connected State */}
            {!isLoading && isConnected && (
                <div className="space-y-2.5">
                    <div className="bg-[var(--color-bg-tertiary)] p-3 rounded-xl border border-[var(--color-border-primary)] transition-all duration-200 hover:border-[var(--color-accent)]/20">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">
                                {account.email || 'Connected'}
                            </div>
                            <span className="text-[10px] px-2 py-1 bg-[var(--color-success-muted)] text-[var(--color-success)] rounded-full font-semibold font-mono tracking-wide">
                                CONNECTED
                            </span>
                        </div>
                        {account.provider && (
                            <div className="text-xs text-[var(--color-text-secondary)]">
                                Provider: {account.provider}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            className={`flex-1 px-3 py-2 text-sm rounded-lg transition-all font-medium ${
                                isSyncing
                                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] cursor-not-allowed'
                                    : 'bg-[var(--color-success)] hover:bg-[var(--color-success)]/90 text-white'
                            }`}
                        >
                            {isSyncing ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Syncing...
                                </span>
                            ) : (
                                'Sync Now'
                            )}
                        </button>
                        <button
                            onClick={handleDisconnect}
                            disabled={isConnecting}
                            className="px-3 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-tertiary)]/70 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm rounded-lg transition-all border border-[var(--color-border-primary)] font-medium disabled:opacity-50"
                        >
                            Disconnect
                        </button>
                    </div>
                </div>
            )}

            {/* Not Connected State */}
            {!isLoading && !isConnected && (
                <div className="space-y-3">
                    <div className="bg-[var(--color-bg-tertiary)] p-3 rounded-xl border border-[var(--color-border-primary)]">
                        <div className="text-xs text-[var(--color-text-secondary)] mb-3">
                            Connect your Google Calendar to access calendar context when tracking time. This helps you understand what you were working on during specific time periods.
                        </div>
                        <button
                            onClick={handleConnect}
                            disabled={isConnecting}
                            className={`w-full px-4 py-2.5 text-sm rounded-lg transition-all font-medium flex items-center justify-center gap-2 ${
                                isConnecting
                                    ? 'bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] cursor-not-allowed'
                                    : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/90 text-white'
                            }`}
                        >
                            {isConnecting ? (
                                <>
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    Connect Google Calendar
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
