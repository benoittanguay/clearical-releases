import { useState, useEffect } from 'react';
import type { TimeEntry, WorkAssignment, TimeBucket } from '../context/StorageContext';
import { TempoService, type TempoAccount } from '../services/tempoService';
import { JiraService } from '../services/jiraService';
import { useTimeRounding } from '../hooks/useTimeRounding';

interface TempoValidationModalProps {
    entry: TimeEntry;
    assignment: WorkAssignment | null;
    buckets: TimeBucket[];
    onClose: () => void;
    onSuccess: () => void;
    formatTime: (ms: number) => string;
    tempoBaseUrl: string;
    tempoApiToken: string;
    jiraBaseUrl: string;
    jiraEmail: string;
    jiraApiToken: string;
    defaultDescription?: string;
}

export function TempoValidationModal({
    entry,
    assignment,
    buckets,
    onClose,
    onSuccess,
    formatTime,
    tempoBaseUrl,
    tempoApiToken,
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
    defaultDescription
}: TempoValidationModalProps) {
    const [description, setDescription] = useState(defaultDescription || entry.description || '');
    const [isLogging, setIsLogging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [availableAccounts, setAvailableAccounts] = useState<TempoAccount[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<string>('');
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const { roundTime, isRoundingEnabled } = useTimeRounding();

    // Calculate the duration to use (rounded if rounding is enabled)
    const durationToLog = isRoundingEnabled ? roundTime(entry.duration).rounded : entry.duration;

    // Extract Jira key from assignment
    const getJiraKey = (): string | null => {
        if (!assignment) return null;

        // Direct Jira assignment
        if (assignment.type === 'jira' && assignment.jiraIssue) {
            return assignment.jiraIssue.key;
        }

        // Bucket with linked Jira issue
        if (assignment.type === 'bucket' && assignment.bucket) {
            // Find the full bucket object to get its linkedIssue
            const fullBucket = buckets.find(b => b.id === assignment.bucket?.id);
            if (fullBucket?.linkedIssue) {
                return fullBucket.linkedIssue.key;
            }
        }

        return null;
    };

    const jiraKey = getJiraKey();

    // Check if we can get Jira key from bucket's linked issue
    useEffect(() => {
        if (!jiraKey && assignment?.type === 'bucket') {
            setError('This bucket is not linked to a Jira issue. Please link a Jira issue to this bucket or select a Jira issue directly.');
        }
    }, [assignment, jiraKey]);

    // Fetch accounts when modal opens and we have a Jira issue
    useEffect(() => {
        const fetchAccounts = async () => {
            if (!jiraKey) {
                return;
            }

            setIsLoadingAccounts(true);
            setError(null);

            try {
                // Initialize services
                const tempoService = new TempoService(tempoBaseUrl, tempoApiToken);
                const jiraService = new JiraService(jiraBaseUrl, jiraEmail, jiraApiToken);

                // Fetch issue details to get project ID and issue ID
                console.log('[TempoValidationModal] Fetching issue details for accounts lookup:', jiraKey);
                const issue = await jiraService.getIssue(jiraKey);
                const projectId = issue.fields.project.id;
                const issueId = issue.id;
                console.log('[TempoValidationModal] Got project ID:', projectId, 'and issue ID:', issueId);

                // Fetch accounts - try project first, then issue-level as fallback
                console.log('[TempoValidationModal] Fetching accounts for project/issue:', projectId, issueId);
                const accounts = await tempoService.getAccountsForIssueOrProject(projectId, issueId);
                console.log('[TempoValidationModal] Fetched accounts:', accounts);

                setAvailableAccounts(accounts);

                // Pre-select if entry already has a tempo account
                if (entry.tempoAccount?.key) {
                    setSelectedAccount(entry.tempoAccount.key);
                } else if (accounts.length === 1) {
                    // Auto-select if only one account
                    setSelectedAccount(accounts[0].key);
                }
            } catch (error) {
                console.error('[TempoValidationModal] Failed to fetch accounts:', error);
                setError(`Failed to fetch accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
                setIsLoadingAccounts(false);
            }
        };

        fetchAccounts();
    }, [jiraKey, tempoBaseUrl, tempoApiToken, jiraBaseUrl, jiraEmail, jiraApiToken, entry.tempoAccount]);

    const handleConfirm = async () => {
        if (!jiraKey) {
            setError('No Jira issue key available for logging.');
            return;
        }

        // Validate account is selected
        if (!selectedAccount) {
            setError('Please select an account before logging time.');
            return;
        }

        setIsLogging(true);
        setError(null);

        try {
            // Initialize services
            const tempoService = new TempoService(tempoBaseUrl, tempoApiToken);
            const jiraService = new JiraService(jiraBaseUrl, jiraEmail, jiraApiToken);

            // Fetch the numeric issue ID from Jira API
            console.log('[TempoValidationModal] Fetching issue ID for key:', jiraKey);
            const issueId = await jiraService.getIssueIdFromKey(jiraKey);
            console.log('[TempoValidationModal] Got issue ID:', issueId);

            // Validate and convert issue ID to number
            const numericIssueId = parseInt(issueId, 10);
            if (isNaN(numericIssueId) || numericIssueId <= 0) {
                throw new Error(`Invalid issue ID received from Jira: ${issueId}`);
            }

            // Get current user's account ID (required by Tempo API)
            console.log('[TempoValidationModal] Fetching current user account ID');
            const currentUser = await jiraService.getCurrentUser();
            console.log('[TempoValidationModal] Got user account ID:', currentUser.accountId);

            // Create worklog with numeric issue ID, author account ID, and account attribute
            const worklog = {
                issueId: numericIssueId,
                timeSpentSeconds: TempoService.durationMsToSeconds(durationToLog),
                startDate: TempoService.formatDate(entry.startTime),
                startTime: TempoService.formatTime(entry.startTime),
                description: description.trim() || `Time logged from Clearical for ${formatTime(durationToLog)}`,
                authorAccountId: currentUser.accountId,
                attributes: [
                    {
                        key: '_Account_',
                        value: selectedAccount
                    }
                ],
            };

            console.log('[TempoValidationModal] Creating worklog:', worklog);
            const response = await tempoService.createWorklog(worklog);

            // Show success message
            alert(`Successfully logged ${formatTime(durationToLog)} to Tempo!\nWorklog ID: ${response.tempoWorklogId}`);

            onSuccess();
        } catch (error) {
            console.error('Failed to log time to Tempo:', error);
            setError(error instanceof Error ? error.message : 'Unknown error occurred');
        } finally {
            setIsLogging(false);
        }
    };

    // Get assignment display information
    const getAssignmentDisplay = () => {
        if (!assignment) {
            return {
                label: 'No assignment',
                color: '#6b7280',
                details: null,
                issueDetails: null
            };
        }

        if (assignment.type === 'jira' && assignment.jiraIssue) {
            return {
                label: assignment.jiraIssue.key,
                color: 'var(--color-accent)',
                details: assignment.jiraIssue.summary,
                issueDetails: `${assignment.jiraIssue.projectName} - ${assignment.jiraIssue.issueType}`
            };
        }

        if (assignment.type === 'bucket' && assignment.bucket) {
            const fullBucket = buckets.find(b => b.id === assignment.bucket?.id);
            const linkedIssue = fullBucket?.linkedIssue;

            return {
                label: assignment.bucket.name,
                color: assignment.bucket.color,
                details: linkedIssue
                    ? linkedIssue.summary
                    : 'Not linked to Jira issue',
                issueDetails: linkedIssue
                    ? `${linkedIssue.projectName} - ${linkedIssue.issueType}`
                    : null
            };
        }

        return {
            label: 'Unknown assignment',
            color: '#6b7280',
            details: null,
            issueDetails: null
        };
    };

    const assignmentDisplay = getAssignmentDisplay();
    const canLog = jiraKey && !isLogging && selectedAccount && !isLoadingAccounts;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in"
                onClick={onClose}
            >
                {/* Modal */}
                <div
                    className="bg-[var(--color-bg-secondary)] rounded-[12px] border border-[var(--color-border-primary)] max-w-lg w-full shadow-2xl animate-scale-in max-h-[90vh] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                    style={{ boxShadow: 'var(--shadow-xl)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-primary)] flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-[var(--color-accent-muted)] rounded-lg flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)]">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M12 6v6l4 2"/>
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Confirm Log to Tempo</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-[var(--color-bg-tertiary)] rounded transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            disabled={isLogging}
                            aria-label="Close dialog"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>

                    {/* Content - Scrollable */}
                    <div className="p-4 space-y-3 overflow-y-auto flex-1">
                        {/* Error message */}
                        {error && (
                            <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 rounded-lg p-3 flex items-start gap-2 animate-fade-in">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-error)] flex-shrink-0 mt-0.5">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                <div className="flex-1">
                                    <div className="text-[var(--color-error)] text-sm font-medium" style={{ fontFamily: 'var(--font-display)' }}>Unable to log time</div>
                                    <div className="text-[var(--color-text-secondary)] text-xs mt-1">{error}</div>
                                </div>
                            </div>
                        )}

                        {/* Jira Issue & Assignment - Consolidated */}
                        {jiraKey && (
                            <div className="bg-[var(--color-bg-tertiary)] rounded-lg p-3 border border-[var(--color-border-primary)]">
                                <div className="flex items-start gap-3">
                                    <div
                                        className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5"
                                        style={{
                                            backgroundColor: assignmentDisplay.color,
                                            boxShadow: `0 0 8px ${assignmentDisplay.color}40`
                                        }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[var(--color-info)] text-base font-semibold" style={{ fontFamily: 'var(--font-mono)' }}>{jiraKey}</span>
                                        </div>
                                        {assignmentDisplay.details && (
                                            <div className="text-[var(--color-text-secondary)] text-sm">{assignmentDisplay.details}</div>
                                        )}
                                        {assignmentDisplay.issueDetails && (
                                            <div className="text-[var(--color-text-tertiary)] text-xs mt-0.5">{assignmentDisplay.issueDetails}</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Time & Account - Compact 2-column layout */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* Duration */}
                            <div className="bg-[var(--color-bg-tertiary)] rounded-lg p-3 border border-[var(--color-border-primary)]">
                                <div className="text-xs text-[var(--color-text-secondary)] uppercase font-semibold mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>Duration</div>
                                <div className="text-[var(--color-success)] text-xl font-bold leading-tight" style={{ fontFamily: 'var(--font-mono)' }}>{formatTime(durationToLog)}</div>
                                {isRoundingEnabled && roundTime(entry.duration).isRounded && (
                                    <div className="text-[var(--color-text-tertiary)] text-xs mt-0.5">
                                        Rounded {roundTime(entry.duration).formattedDifference}
                                    </div>
                                )}
                            </div>

                            {/* Date & Time */}
                            <div className="bg-[var(--color-bg-tertiary)] rounded-lg p-3 border border-[var(--color-border-primary)]">
                                <div className="text-xs text-[var(--color-text-secondary)] uppercase font-semibold mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>When</div>
                                <div className="text-[var(--color-text-primary)] text-sm font-medium leading-tight" style={{ fontFamily: 'var(--font-mono)' }}>
                                    {new Date(entry.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </div>
                                <div className="text-[var(--color-text-secondary)] text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)' }}>
                                    {new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                                </div>
                            </div>
                        </div>

                        {/* Account Selection */}
                        {jiraKey && (
                            <div>
                                <label className="block text-xs text-[var(--color-text-secondary)] uppercase font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                                    Account <span className="text-[var(--color-error)]">*</span>
                                </label>
                                {isLoadingAccounts ? (
                                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] rounded-lg px-3 py-2 border border-[var(--color-border-primary)]">
                                        <div className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin"></div>
                                        <span>Loading accounts...</span>
                                    </div>
                                ) : availableAccounts.length === 0 ? (
                                    <div className="text-sm text-[var(--color-warning)] bg-[var(--color-warning-muted)] border border-[var(--color-warning)]/30 rounded-lg px-3 py-2">
                                        No accounts linked to this issue. Please configure accounts in Tempo.
                                    </div>
                                ) : (
                                    <select
                                        value={selectedAccount}
                                        onChange={(e) => setSelectedAccount(e.target.value)}
                                        disabled={isLogging}
                                        className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                        style={{ fontFamily: 'var(--font-mono)', transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                    >
                                        <option value="">Select an account...</option>
                                        {availableAccounts.map((account) => (
                                            <option key={account.id} value={account.key}>
                                                {account.name} ({account.key})
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}

                        {/* Description */}
                        <div>
                            <label className="block text-xs text-[var(--color-text-secondary)] uppercase font-semibold mb-2" style={{ fontFamily: 'var(--font-display)' }}>Description</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add a description for this worklog..."
                                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] resize-none transition-all"
                                style={{ fontFamily: 'var(--font-mono)', transitionDuration: 'var(--duration-base)', transitionTimingFunction: 'var(--ease-out)' }}
                                rows={3}
                                disabled={isLogging}
                            />
                        </div>
                    </div>

                    {/* Footer - Sticky */}
                    <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                        <button
                            onClick={onClose}
                            disabled={isLogging}
                            className="px-4 py-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!canLog}
                            className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white rounded-full transition-all active:scale-[0.99] flex items-center gap-2 min-w-[120px] justify-center shadow-lg"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            {isLogging ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>Logging...</span>
                                </>
                            ) : (
                                <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    <span>Confirm & Log</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
