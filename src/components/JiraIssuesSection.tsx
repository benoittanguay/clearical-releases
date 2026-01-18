import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useCrawlerProgress } from '../context/CrawlerProgressContext';
import { useJiraCache } from '../context/JiraCacheContext';
import type { JiraIssue } from '../services/jiraService';

interface TabData {
    issues: JiraIssue[];
    loading: boolean;
    error: string | null;
}

interface JiraIssuesSectionProps {
    onIssueClick?: (issue: JiraIssue) => void;
}

export function JiraIssuesSection({ onIssueClick }: JiraIssuesSectionProps = {}) {
    const { settings } = useSettings();
    const { hasFeature } = useSubscription();
    const { projects, isActive, totalIssuesFound } = useCrawlerProgress();
    const jiraCache = useJiraCache();
    const [activeTab, setActiveTab] = useState<string>('assigned');
    const [searchQuery, setSearchQuery] = useState('');
    const [tabData, setTabData] = useState<Record<string, TabData>>({});

    // Get available tabs - simple, no complex dependencies
    const getAvailableTabs = () => {
        const tabs = [{ key: 'assigned', label: 'Assigned to Me' }];
        
        if (settings.jira?.selectedProjects?.length) {
            settings.jira.selectedProjects.forEach(project => {
                tabs.push({ key: `project-${project}`, label: project });
            });
        }
        
        tabs.push({ key: 'search', label: 'Search' });
        return tabs;
    };

    // Note: JiraCache initialization is handled by JiraCacheContext

    const hasJiraAccess = hasFeature('jira');

    // Simple loading function without complex dependencies
    const loadTabData = async (tabKey: string) => {
        if (tabKey === 'search') return;

        if (!hasJiraAccess) {
            return;
        }

        const { jira } = settings;
        if (!jira?.enabled || !jira?.apiToken || !jira?.baseUrl || !jira?.email) {
            return;
        }

        // Set loading
        setTabData(prev => ({
            ...prev,
            [tabKey]: { issues: [], loading: true, error: null }
        }));

        try {
            let issues: JiraIssue[];

            if (tabKey === 'assigned') {
                issues = await jiraCache.getAssignedIssues();
            } else if (tabKey.startsWith('project-')) {
                const projectKey = tabKey.replace('project-', '');
                issues = await jiraCache.getProjectIssues(projectKey);
            } else {
                issues = [];
            }

            setTabData(prev => ({
                ...prev,
                [tabKey]: {
                    issues,
                    loading: false,
                    error: null
                }
            }));
        } catch (err) {
            setTabData(prev => ({
                ...prev,
                [tabKey]: {
                    issues: [],
                    loading: false,
                    error: err instanceof Error ? err.message : 'Failed to load issues'
                }
            }));
        }
    };

    // Search function
    const handleSearch = async () => {
        if (!hasJiraAccess) {
            return;
        }

        const { jira } = settings;
        if (!jira?.enabled || !jira?.apiToken || !jira?.baseUrl || !jira?.email || !searchQuery.trim()) {
            return;
        }

        setTabData(prev => ({
            ...prev,
            search: { issues: [], loading: true, error: null }
        }));

        try {
            const issues = await jiraCache.searchIssues(searchQuery.trim());
            
            setTabData(prev => ({
                ...prev,
                search: {
                    issues,
                    loading: false,
                    error: null
                }
            }));
        } catch (err) {
            setTabData(prev => ({
                ...prev,
                search: {
                    issues: [],
                    loading: false,
                    error: err instanceof Error ? err.message : 'Search failed'
                }
            }));
        }
    };

    // Load data when activeTab changes - simple effect
    useEffect(() => {
        loadTabData(activeTab);
    }, [activeTab]); // Only depend on activeTab

    // Initialize first tab and setup background sync
    useEffect(() => {
        const tabs = getAvailableTabs();
        if (tabs.length > 0) {
            setActiveTab(tabs[0].key);
        }

        // Setup background sync for selected projects
        const { jira } = settings;
        if (jira?.enabled && jira?.selectedProjects?.length) {
            jiraCache.syncAllData(jira.selectedProjects);
        }
    }, []); // Run only once on mount


    const getStatusColor = (statusCategory: string) => {
        switch (statusCategory.toLowerCase()) {
            case 'new':
                return { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: 'var(--color-info)', border: '1px solid rgba(59, 130, 246, 0.3)' };
            case 'indeterminate':
                return { backgroundColor: 'rgba(250, 204, 21, 0.15)', color: 'var(--color-warning)', border: '1px solid rgba(250, 204, 21, 0.3)' };
            case 'done':
                return { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--color-success)', border: '1px solid rgba(34, 197, 94, 0.3)' };
            default:
                return { backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-primary)' };
        }
    };

    const tabs = getAvailableTabs();
    const currentTabData = tabData[activeTab] || { issues: [], loading: false, error: null };

    // If user doesn't have Jira access, show upgrade prompt
    if (!hasJiraAccess) {
        return (
            <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold"
                        style={{
                            color: 'var(--color-text-primary)',
                            fontFamily: 'var(--font-display)'
                        }}>
                        Jira Issues
                    </h3>
                    <span className="text-xs px-2 py-1 rounded border"
                          style={{
                              backgroundColor: 'rgba(250, 204, 21, 0.1)',
                              color: 'var(--color-warning)',
                              borderColor: 'rgba(250, 204, 21, 0.3)',
                              fontFamily: 'var(--font-body)'
                          }}>
                        WORKPLACE ONLY
                    </span>
                </div>
                <div className="rounded-xl p-6 border"
                     style={{
                         backgroundColor: 'var(--color-bg-secondary)',
                         borderColor: 'var(--color-border-primary)',
                         borderRadius: 'var(--radius-xl)'
                     }}>
                    <div className="text-center">
                        <svg className="w-12 h-12 mx-auto mb-3"
                             style={{ color: 'var(--color-warning)' }}
                             fill="currentColor"
                             viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        <h4 className="text-lg font-semibold mb-2"
                            style={{
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-display)'
                            }}>
                            Jira Integration Locked
                        </h4>
                        <p className="text-sm mb-4"
                           style={{
                               color: 'var(--color-text-secondary)',
                               fontFamily: 'var(--font-body)'
                           }}>
                            Upgrade to Workplace Plan to connect your Jira account and track time to issues
                        </p>
                        <button
                            className="px-6 py-2 text-sm rounded transition-all"
                            style={{
                                backgroundColor: 'var(--color-accent)',
                                color: 'var(--color-bg-primary)',
                                fontFamily: 'var(--font-body)',
                                fontWeight: 'var(--font-semibold)',
                                transitionDuration: 'var(--duration-base)',
                                transitionTimingFunction: 'var(--ease-out)'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                        >
                            Upgrade to Workplace
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
                <h3
                    className="text-lg font-bold"
                    style={{
                        fontFamily: 'var(--font-display)',
                        color: 'var(--color-text-primary)'
                    }}
                >
                    Jira Issues
                </h3>
                <button
                    onClick={() => {
                        if (activeTab === 'assigned') {
                            jiraCache.getAssignedIssues(true).then(issues => {
                                setTabData(prev => ({
                                    ...prev,
                                    [activeTab]: { issues, loading: false, error: null }
                                }));
                            });
                        } else if (activeTab.startsWith('project-')) {
                            const projectKey = activeTab.replace('project-', '');
                            jiraCache.getProjectIssues(projectKey, true).then(issues => {
                                setTabData(prev => ({
                                    ...prev,
                                    [activeTab]: { issues, loading: false, error: null }
                                }));
                            });
                        }
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                    style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-body)',
                        border: '1px solid var(--color-border-primary)',
                        transitionDuration: 'var(--duration-base)',
                        transitionTimingFunction: 'var(--ease-out)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-quaternary)';
                        e.currentTarget.style.borderColor = 'var(--color-accent-border)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                    }}
                    disabled={currentTabData.loading}
                >
                    Refresh
                </button>
            </div>

            {/* Crawler Status Section */}
            {Object.keys(projects).length > 0 && (
                <div className="mb-4 rounded-xl p-4 border"
                     style={{
                         backgroundColor: 'var(--color-bg-secondary)',
                         borderColor: 'var(--color-border-primary)',
                         borderRadius: 'var(--radius-xl)'
                     }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <svg
                                className={`w-4 h-4 ${isActive ? 'animate-spin' : ''}`}
                                style={{
                                    animationDuration: '2s',
                                    color: 'var(--color-success)'
                                }}
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                            </svg>
                            <span className="text-xs font-medium"
                                  style={{
                                      color: 'var(--color-text-primary)',
                                      fontFamily: 'var(--font-body)'
                                  }}>
                                {isActive ? 'Syncing projects...' : 'Projects synced'}
                            </span>
                        </div>
                        <span className="text-xs"
                              style={{
                                  color: 'var(--color-text-secondary)',
                                  fontFamily: 'var(--font-body)'
                              }}>
                            {totalIssuesFound} total issues discovered
                        </span>
                    </div>

                    {/* Per-project status */}
                    <div className="space-y-1.5">
                        {Object.values(projects).map(project => (
                            <div key={project.projectKey} className="flex items-center justify-between text-xs">
                                <span className="font-medium"
                                      style={{
                                          color: project.isComplete ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                                          fontFamily: 'var(--font-body)'
                                      }}>
                                    {project.projectKey}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span style={{
                                        color: 'var(--color-text-tertiary)',
                                        fontFamily: 'var(--font-body)'
                                    }}>
                                        {project.issuesFound} issues
                                    </span>
                                    {project.isComplete && (
                                        <svg className="w-4 h-4"
                                             style={{ color: 'var(--color-success)' }}
                                             fill="currentColor"
                                             viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {isActive && (
                        <div className="mt-2 pt-2 border-t"
                             style={{ borderColor: 'var(--color-border-primary)' }}>
                            <p className="text-xs"
                               style={{
                                   color: 'var(--color-text-tertiary)',
                                   fontFamily: 'var(--font-body)'
                               }}>
                                The crawler is discovering all issues in your projects. Check the top bar for detailed progress.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Tab Navigation */}
            <div className="flex space-x-1 mb-3 overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap"
                        style={{
                            backgroundColor: activeTab === tab.key ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                            color: activeTab === tab.key ? '#FFFFFF' : 'var(--color-text-primary)',
                            fontFamily: 'var(--font-body)',
                            borderRadius: 'var(--radius-lg)',
                            transitionDuration: 'var(--duration-base)',
                            transitionTimingFunction: 'var(--ease-out)'
                        }}
                        onMouseEnter={(e) => {
                            if (activeTab !== tab.key) {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-quaternary)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (activeTab !== tab.key) {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                            }
                        }}
                    >
                        {tab.label}
                        {tabData[tab.key]?.loading ? (
                            <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            tabData[tab.key]?.issues && (
                                <span className="ml-1">({tabData[tab.key].issues.length})</span>
                            )
                        )}
                    </button>
                ))}
            </div>

            {/* Search Input */}
            {activeTab === 'search' && (
                <div className="flex gap-2 mb-3">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Search issues by text..."
                        className="flex-1 text-sm rounded px-3 py-2 focus:outline-none transition-all"
                        style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            border: '1px solid var(--color-border-primary)',
                            color: 'var(--color-text-primary)',
                            fontFamily: 'var(--font-body)',
                            transitionDuration: 'var(--duration-base)',
                            transitionTimingFunction: 'var(--ease-out)'
                        }}
                        onFocus={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-accent)';
                            e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    />
                    <button
                        onClick={handleSearch}
                        disabled={currentTabData.loading || !searchQuery.trim()}
                        className="px-3 py-1.5 text-sm rounded transition-all"
                        style={{
                            backgroundColor: currentTabData.loading || !searchQuery.trim()
                                ? 'var(--color-bg-tertiary)'
                                : 'var(--color-accent)',
                            color: currentTabData.loading || !searchQuery.trim()
                                ? 'var(--color-text-tertiary)'
                                : '#FFFFFF',
                            fontFamily: 'var(--font-body)',
                            cursor: currentTabData.loading || !searchQuery.trim() ? 'not-allowed' : 'pointer',
                            transitionDuration: 'var(--duration-base)',
                            transitionTimingFunction: 'var(--ease-out)'
                        }}
                        onMouseEnter={(e) => {
                            if (!currentTabData.loading && searchQuery.trim()) {
                                e.currentTarget.style.opacity = '0.9';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!currentTabData.loading && searchQuery.trim()) {
                                e.currentTarget.style.opacity = '1';
                            }
                        }}
                    >
                        {currentTabData.loading ? 'Searching...' : 'Search'}
                    </button>
                </div>
            )}

            {/* Error State */}
            {currentTabData.error && (
                <div className="rounded-lg p-2.5 mb-3 border"
                     style={{
                         backgroundColor: 'rgba(239, 68, 68, 0.1)',
                         borderColor: 'rgba(239, 68, 68, 0.3)',
                         borderRadius: 'var(--radius-lg)'
                     }}>
                    <p className="text-sm"
                       style={{
                           color: 'var(--color-error)',
                           fontFamily: 'var(--font-body)'
                       }}>
                        {currentTabData.error}
                    </p>
                    <button
                        onClick={() => loadTabData(activeTab)}
                        className="mt-2 text-xs underline transition-colors"
                        style={{
                            color: 'var(--color-error)',
                            fontFamily: 'var(--font-body)',
                            transitionDuration: 'var(--duration-fast)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-error)'}
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Issues List */}
            <div className="rounded-xl p-4 border"
                 style={{
                     backgroundColor: 'var(--color-bg-secondary)',
                     borderColor: 'var(--color-border-primary)',
                     borderRadius: 'var(--radius-xl)'
                 }}>
                {currentTabData.loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-8 h-8 border-2 rounded-full animate-spin"
                             style={{
                                 borderColor: 'var(--color-accent)',
                                 borderTopColor: 'transparent'
                             }}></div>
                        <span className="ml-3 font-medium"
                              style={{
                                  color: 'var(--color-text-secondary)',
                                  fontFamily: 'var(--font-body)'
                              }}>Loading issues...</span>
                    </div>
                ) : currentTabData.issues.length === 0 ? (
                    <div className="text-center py-10"
                         style={{ color: 'var(--color-text-tertiary)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3" style={{ opacity: 0.4 }}>
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                        <p className="text-sm font-medium mb-1"
                           style={{
                               color: 'var(--color-text-secondary)',
                               fontFamily: 'var(--font-body)'
                           }}>No issues found</p>
                        <p className="text-xs"
                           style={{ fontFamily: 'var(--font-body)' }}>
                            {activeTab === 'search'
                                ? 'Try searching with different keywords'
                                : 'Issues will appear here when available from your Jira instance'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {currentTabData.issues.map((issue) => {
                            const isEpic = issue.fields.issuetype.name.toLowerCase() === 'epic';

                            return (
                                <div
                                    key={issue.id}
                                    onClick={() => onIssueClick?.(issue)}
                                    className="rounded-lg p-3 border transition-all cursor-pointer"
                                    style={{
                                        backgroundColor: isEpic ? 'rgba(168, 85, 247, 0.05)' : 'var(--color-bg-tertiary)',
                                        borderColor: isEpic ? 'rgba(168, 85, 247, 0.3)' : 'var(--color-border-secondary)',
                                        borderRadius: 'var(--radius-lg)',
                                        transitionDuration: 'var(--duration-base)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = isEpic ? 'rgba(168, 85, 247, 0.1)' : 'var(--color-bg-quaternary)';
                                        e.currentTarget.style.borderColor = 'var(--color-accent-border)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = isEpic ? 'rgba(168, 85, 247, 0.05)' : 'var(--color-bg-tertiary)';
                                        e.currentTarget.style.borderColor = isEpic ? 'rgba(168, 85, 247, 0.3)' : 'var(--color-border-secondary)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="font-mono text-sm font-semibold"
                                                      style={{
                                                          color: 'var(--color-info)',
                                                          fontFamily: 'var(--font-mono)'
                                                      }}>
                                                    {issue.key}
                                                </span>
                                                <span className="text-xs"
                                                      style={{
                                                          color: 'var(--color-text-tertiary)',
                                                          fontFamily: 'var(--font-body)'
                                                      }}>
                                                    {issue.fields.project.name}
                                                </span>
                                                <span className="text-xs px-2 py-0.5 rounded"
                                                      style={{
                                                          backgroundColor: isEpic ? 'rgba(168, 85, 247, 0.2)' : 'var(--color-bg-quaternary)',
                                                          color: isEpic ? '#c084fc' : 'var(--color-text-secondary)',
                                                          border: isEpic ? '1px solid rgba(168, 85, 247, 0.4)' : 'none',
                                                          fontFamily: 'var(--font-body)',
                                                          fontWeight: isEpic ? 'var(--font-semibold)' : 'normal'
                                                      }}>
                                                    {issue.fields.issuetype.name}
                                                </span>
                                            </div>
                                            <h4 className="font-medium text-sm mb-2 line-clamp-2"
                                                style={{
                                                    color: 'var(--color-text-primary)',
                                                    fontFamily: 'var(--font-body)'
                                                }}>
                                                {issue.fields.summary}
                                            </h4>
                                            <div className="flex items-center gap-2">
                                                <span className="px-2 py-1 rounded text-xs"
                                                      style={{
                                                          ...getStatusColor(issue.fields.status.statusCategory.key),
                                                          fontFamily: 'var(--font-body)',
                                                          fontWeight: 'var(--font-medium)'
                                                      }}>
                                                    {issue.fields.status.name}
                                                </span>
                                                {issue.fields.assignee && (
                                                    <span className="text-xs"
                                                          style={{
                                                              color: 'var(--color-text-tertiary)',
                                                              fontFamily: 'var(--font-body)'
                                                          }}>
                                                        → {issue.fields.assignee.displayName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {currentTabData.issues.length > 0 && (
                <p className="text-xs mt-3 text-center"
                   style={{
                       color: 'var(--color-text-tertiary)',
                       fontFamily: 'var(--font-body)'
                   }}>
                    Click on any issue above to link it to a time entry
                </p>
            )}
        </div>
    );
}