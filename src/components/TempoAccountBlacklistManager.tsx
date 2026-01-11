import { useState, useEffect, useMemo } from 'react';
import type { BlacklistedTempoAccount } from '../types/electron';
import type { TempoAccount } from '../services/tempoService';

interface TempoAccountBlacklistManagerProps {
    className?: string;
    tempoApiToken?: string;
    tempoBaseUrl?: string;
}

export function TempoAccountBlacklistManager({
    className = '',
    tempoApiToken,
    tempoBaseUrl
}: TempoAccountBlacklistManagerProps) {
    const [blacklistedAccounts, setBlacklistedAccounts] = useState<BlacklistedTempoAccount[]>([]);
    const [allAccounts, setAllAccounts] = useState<TempoAccount[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load data on mount and when Tempo settings change
    useEffect(() => {
        loadData();
    }, [tempoApiToken, tempoBaseUrl]);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);

            // Load blacklisted accounts from database
            const blacklistedResponse = await window.electron.ipcRenderer.tempoAccountBlacklist.getBlacklistedAccounts();
            if (blacklistedResponse.success) {
                setBlacklistedAccounts(blacklistedResponse.data || []);
            } else {
                console.error('[TempoAccountBlacklistManager] Failed to load blacklisted accounts:', blacklistedResponse.error);
                setError('Failed to load blacklisted accounts');
            }

            // Load all Tempo accounts if credentials are available
            if (tempoApiToken && tempoBaseUrl) {
                try {
                    const { TempoService } = await import('../services/tempoService');
                    const service = new TempoService(tempoBaseUrl, tempoApiToken);
                    const accounts = await service.getAllAccounts();
                    setAllAccounts(accounts);
                } catch (tempoError) {
                    console.error('[TempoAccountBlacklistManager] Failed to load Tempo accounts:', tempoError);
                    // Don't set error here - user might just need to configure Tempo first
                }
            }
        } catch (err) {
            console.error('[TempoAccountBlacklistManager] Failed to load data:', err);
            setError('Failed to load account data');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleAccount = async (account: TempoAccount, isBlacklisted: boolean) => {
        try {
            if (isBlacklisted) {
                await window.electron.ipcRenderer.tempoAccountBlacklist.removeBlacklistedAccount(account.key);
            } else {
                await window.electron.ipcRenderer.tempoAccountBlacklist.addBlacklistedAccount(
                    account.key,
                    account.id,
                    account.name
                );
            }
            await loadData();
        } catch (err) {
            console.error('[TempoAccountBlacklistManager] Failed to toggle account:', err);
            setError('Failed to update account blacklist');
        }
    };

    // Create a map for quick blacklist lookup
    const blacklistedAccountKeys = useMemo(() => {
        return new Set(blacklistedAccounts.map(account => account.accountKey));
    }, [blacklistedAccounts]);

    // Filter accounts based on search query
    const filteredAccounts = useMemo(() => {
        if (!searchQuery) {
            return allAccounts;
        }
        const query = searchQuery.toLowerCase();
        return allAccounts.filter(account =>
            account.name.toLowerCase().includes(query) ||
            account.key.toLowerCase().includes(query)
        );
    }, [allAccounts, searchQuery]);

    // Calculate statistics
    const stats = useMemo(() => {
        const total = allAccounts.length;
        const excluded = blacklistedAccounts.length;
        const visible = filteredAccounts.length;
        return { total, excluded, visible };
    }, [allAccounts, blacklistedAccounts, filteredAccounts]);

    // Check if Tempo is configured
    const isTempoConfigured = !!(tempoApiToken && tempoBaseUrl);

    return (
        <div className={className}>
            {/* Header with description */}
            <div className="mb-4">
                <h4 className="text-sm font-semibold text-white mb-2">Excluded Tempo Accounts</h4>
                <p className="text-xs text-gray-500">
                    Exclude specific Tempo accounts from being suggested for time logging. Excluded accounts will not appear in the account selection dropdown.
                </p>
            </div>

            {/* Error message */}
            {error && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-xs text-red-400">
                    {error}
                </div>
            )}

            {/* Not configured message */}
            {!isTempoConfigured && !loading && (
                <div className="bg-gray-900 p-6 rounded-lg border border-gray-700 text-center">
                    <div className="text-sm text-gray-400 mb-2">Tempo not configured</div>
                    <div className="text-xs text-gray-500">
                        Please configure your Tempo API token above to manage account exclusions.
                    </div>
                </div>
            )}

            {/* Loading state */}
            {loading && isTempoConfigured && (
                <div className="bg-gray-900 p-8 rounded-lg border border-gray-700 text-center">
                    <div className="w-4 h-4 border border-gray-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <div className="text-sm text-gray-500">Loading accounts...</div>
                </div>
            )}

            {/* Main content */}
            {!loading && isTempoConfigured && (
                <>
                    {/* Statistics */}
                    <div className="mb-4 flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">Total accounts:</span>
                            <span className="font-medium text-white">{stats.total}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500">Excluded:</span>
                            <span className="font-medium text-red-400">{stats.excluded}</span>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search accounts by name or key..."
                                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                            />
                            <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Accounts List */}
                    {filteredAccounts.length === 0 ? (
                        <div className="bg-gray-900 p-8 rounded-lg border border-gray-700 text-center">
                            <div className="text-sm text-gray-500">
                                {allAccounts.length === 0
                                    ? 'No Tempo accounts found'
                                    : 'No accounts match your search'}
                            </div>
                            {allAccounts.length === 0 && (
                                <div className="text-xs text-gray-600 mt-1">
                                    Make sure your Tempo connection is working correctly.
                                </div>
                            )}
                            {searchQuery && allAccounts.length > 0 && (
                                <div className="text-xs text-gray-600 mt-1">
                                    Try a different search term
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                            <div className="max-h-64 overflow-y-auto">
                                {filteredAccounts.map(account => {
                                    const isBlacklisted = blacklistedAccountKeys.has(account.key);

                                    return (
                                        <label
                                            key={account.key}
                                            className="flex items-center gap-3 p-3 hover:bg-gray-800 transition-colors cursor-pointer border-b border-gray-700 last:border-b-0 group"
                                        >
                                            {/* Checkbox */}
                                            <input
                                                type="checkbox"
                                                checked={isBlacklisted}
                                                onChange={() => handleToggleAccount(account, isBlacklisted)}
                                                className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-red-600 focus:ring-2 focus:ring-red-500 focus:ring-offset-0 cursor-pointer transition-colors"
                                            />

                                            {/* Account Icon */}
                                            <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                                </svg>
                                            </div>

                                            {/* Account Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-white truncate">
                                                    {account.name}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {account.key}
                                                    {account.global && (
                                                        <span className="ml-2 text-blue-400">(Global)</span>
                                                    )}
                                                    {account.status !== 'OPEN' && (
                                                        <span className="ml-2 text-yellow-400">({account.status})</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Status Badge */}
                                            {isBlacklisted && (
                                                <div className="text-xs px-2 py-1 bg-red-900/30 text-red-400 rounded flex-shrink-0">
                                                    EXCLUDED
                                                </div>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
