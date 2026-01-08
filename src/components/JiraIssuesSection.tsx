import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { JiraCache } from '../services/jiraCache';
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
    const [activeTab, setActiveTab] = useState<string>('assigned');
    const [searchQuery, setSearchQuery] = useState('');
    const [tabData, setTabData] = useState<Record<string, TabData>>({});
    const [jiraCache] = useState(() => new JiraCache());

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

    // Initialize cache service when settings change
    useEffect(() => {
        const { jira } = settings;
        if (jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);
            if (jira.selectedProjects?.length) {
                jiraCache.setSelectedProjects(jira.selectedProjects);
            }
        }
    }, [settings.jira, jiraCache]);

    // Simple loading function without complex dependencies
    const loadTabData = async (tabKey: string) => {
        if (tabKey === 'search') return;
        
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

        // Cleanup function
        return () => {
            jiraCache.destroy();
        };
    }, []); // Run only once on mount


    const getStatusColor = (statusCategory: string) => {
        switch (statusCategory.toLowerCase()) {
            case 'new':
                return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
            case 'indeterminate':
                return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
            case 'done':
                return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
        }
    };

    const tabs = getAvailableTabs();
    const currentTabData = tabData[activeTab] || { issues: [], loading: false, error: null };

    return (
        <div className="mt-8">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Jira Issues</h3>
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
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                    disabled={currentTabData.loading}
                >
                    Refresh
                </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex space-x-1 mb-4 overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap ${
                            activeTab === tab.key
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
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
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Search issues by text..."
                        className="flex-1 bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleSearch}
                        disabled={currentTabData.loading || !searchQuery.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
                    >
                        {currentTabData.loading ? 'Searching...' : 'Search'}
                    </button>
                </div>
            )}

            {/* Error State */}
            {currentTabData.error && (
                <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4">
                    <p className="text-red-300 text-sm">{currentTabData.error}</p>
                    <button
                        onClick={() => loadTabData(activeTab)}
                        className="mt-2 text-xs text-red-200 hover:text-white underline"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Issues List */}
            <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
                {currentTabData.loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span className="ml-2 text-gray-300">Loading issues...</span>
                    </div>
                ) : currentTabData.issues.length === 0 ? (
                    <div className="text-center py-6 text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 opacity-50">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                        <p className="text-sm">No issues found</p>
                        <p className="text-xs mt-1">
                            {activeTab === 'search' 
                                ? 'Try searching with different keywords'
                                : 'Issues will appear here when available from your Jira instance'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {currentTabData.issues.map((issue) => (
                            <div
                                key={issue.id}
                                onClick={() => onIssueClick?.(issue)}
                                className="bg-gray-900/50 border border-gray-600 rounded-lg p-3 hover:bg-gray-800/50 transition-colors cursor-pointer"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-blue-400 font-mono text-sm font-medium">
                                                {issue.key}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                {issue.fields.project.name}
                                            </span>
                                            <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                                {issue.fields.issuetype.name}
                                            </span>
                                        </div>
                                        <h4 className="text-white font-medium text-sm mb-2 line-clamp-2">
                                            {issue.fields.summary}
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2 py-1 rounded text-xs ${getStatusColor(issue.fields.status.statusCategory.key)}`}>
                                                {issue.fields.status.name}
                                            </span>
                                            {issue.fields.assignee && (
                                                <span className="text-xs text-gray-400">
                                                    → {issue.fields.assignee.displayName}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {currentTabData.issues.length > 0 && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                    Click on any issue above to link it to a time entry
                </p>
            )}
        </div>
    );
}