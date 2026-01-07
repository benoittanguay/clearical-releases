import { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { JiraService, JiraIssue } from '../services/jiraService';

export function JiraIssuesSection() {
    const { settings } = useSettings();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [assignedIssues, setAssignedIssues] = useState<JiraIssue[]>([]);
    const [epics, setEpics] = useState<JiraIssue[]>([]);
    const [recentIssues, setRecentIssues] = useState<JiraIssue[]>([]);
    const [activeTab, setActiveTab] = useState<'assigned' | 'recent' | 'epics' | 'search'>('assigned');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<JiraIssue[]>([]);
    const [fetchAll, setFetchAll] = useState(false);
    
    // Use ref to store JiraService instance to prevent recreation on every render
    const jiraServiceRef = useRef<JiraService | null>(null);
    const hasLoadedRef = useRef(false);

    // Create JiraService instance only when needed and cache it
    const getJiraService = useCallback(() => {
        const isEnabled = settings.jira?.enabled;
        const apiToken = settings.jira?.apiToken;
        const baseUrl = settings.jira?.baseUrl;
        const email = settings.jira?.email;

        if (!isEnabled || !apiToken || !baseUrl || !email) {
            jiraServiceRef.current = null;
            return null;
        }

        // Only create new instance if settings have actually changed
        if (!jiraServiceRef.current) {
            console.log('[JiraIssuesSection] Creating new JiraService instance');
            jiraServiceRef.current = new JiraService(baseUrl, email, apiToken);
        }

        return jiraServiceRef.current;
    }, [settings.jira?.enabled, settings.jira?.apiToken, settings.jira?.baseUrl, settings.jira?.email]);

    const loadIssues = useCallback(async (type: 'assigned' | 'recent' | 'epics') => {
        const jiraService = getJiraService();
        if (!jiraService) {
            return;
        }

        console.log('[JiraIssuesSection] Loading', type, 'issues');
        setLoading(true);
        setError(null);

        try {
            let response;
            const maxResults = fetchAll ? -1 : (type === 'assigned' ? 100 : type === 'recent' ? 50 : 50);
            
            switch (type) {
                case 'assigned':
                    response = await jiraService.getMyAssignedIssues(maxResults);
                    setAssignedIssues(response.issues);
                    break;
                case 'recent':
                    response = await jiraService.getMyRecentIssues(maxResults);
                    setRecentIssues(response.issues);
                    break;
                case 'epics':
                    response = await jiraService.getAvailableEpics(maxResults);
                    setEpics(response.issues);
                    break;
            }
            console.log('[JiraIssuesSection] Loaded', response.issues.length, 'of', response.total, type, 'issues');
        } catch (err) {
            console.error('[JiraIssuesSection] Failed to load', type, 'issues:', err);
            setError(err instanceof Error ? err.message : `Failed to load ${type} issues`);
        } finally {
            setLoading(false);
        }
    }, [getJiraService]);

    const handleSearch = useCallback(async () => {
        const jiraService = getJiraService();
        if (!jiraService || !searchQuery.trim() || loading) {
            return;
        }

        console.log('[JiraIssuesSection] Searching for:', searchQuery);
        setLoading(true);
        setError(null);

        try {
            const response = await jiraService.searchIssuesByText(searchQuery.trim());
            setSearchResults(response.issues);
            console.log('[JiraIssuesSection] Found', response.issues.length, 'search results');
        } catch (err) {
            console.error('[JiraIssuesSection] Search failed:', err);
            setError(err instanceof Error ? err.message : 'Search failed');
        } finally {
            setLoading(false);
        }
    }, [getJiraService, searchQuery]);

    // Load initial data when component mounts
    useEffect(() => {
        console.log('[JiraIssuesSection] useEffect triggered');
        const jiraService = getJiraService();
        console.log('[JiraIssuesSection] JiraService:', !!jiraService, 'hasLoaded:', hasLoadedRef.current);
        if (jiraService && !hasLoadedRef.current) {
            hasLoadedRef.current = true;
            // Load assigned issues by default
            loadIssues('assigned');
        }
    }, [getJiraService, loadIssues]);

    // Reload data when fetchAll setting changes
    useEffect(() => {
        if (jiraServiceRef.current) {
            loadIssues(activeTab === 'search' ? 'assigned' : activeTab);
        }
    }, [fetchAll, loadIssues, activeTab]);

    // Load data when switching tabs
    useEffect(() => {
        if (activeTab === 'assigned' && assignedIssues.length === 0) {
            loadIssues('assigned');
        } else if (activeTab === 'recent' && recentIssues.length === 0) {
            loadIssues('recent');
        } else if (activeTab === 'epics' && epics.length === 0) {
            loadIssues('epics');
        }
    }, [activeTab, assignedIssues.length, recentIssues.length, epics.length, loadIssues]);

    const handleRefresh = () => {
        hasLoadedRef.current = false;
        setAssignedIssues([]);
        setRecentIssues([]);
        setEpics([]);
        setSearchResults([]);
        const jiraService = getJiraService();
        if (jiraService) {
            loadIssues(activeTab === 'search' ? 'assigned' : activeTab);
        }
    };

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

    const getCurrentIssues = () => {
        switch (activeTab) {
            case 'assigned':
                return assignedIssues;
            case 'recent':
                return recentIssues;
            case 'epics':
                return epics;
            case 'search':
                return searchResults;
            default:
                return [];
        }
    };

    const jiraService = getJiraService();
    const currentIssues = getCurrentIssues();
    
    console.log('[JiraIssuesSection] Component rendering, currentIssues:', currentIssues.length);
    
    return (
        <div className="mt-8">
            <div className="bg-red-500 text-white p-2 mb-4 flex justify-between items-center">
                <div>
                    DEBUG: JiraIssuesSection | 
                    JiraService: {jiraService ? 'OK' : 'NULL'} | 
                    Loading: {loading ? 'YES' : 'NO'} | 
                    Tab: {activeTab} | 
                    Issues: {currentIssues.length}
                </div>
                <button
                    onClick={handleRefresh}
                    className="bg-white text-red-500 px-2 py-1 rounded text-sm"
                    disabled={loading}
                >
                    {loading ? 'Loading...' : 'Refresh'}
                </button>
            </div>

            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <h3 className="text-lg font-semibold text-white">Available Jira Issues</h3>
                    <div className="flex items-center gap-2">
                        <input
                            id="fetch-all-checkbox"
                            type="checkbox"
                            checked={fetchAll}
                            onChange={(e) => setFetchAll(e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                        />
                        <label htmlFor="fetch-all-checkbox" className="text-sm text-gray-300">
                            Fetch all items
                        </label>
                    </div>
                </div>
                {loading && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        Loading...
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="flex space-x-1 mb-4">
                <button
                    onClick={() => setActiveTab('assigned')}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        activeTab === 'assigned'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    Assigned ({assignedIssues.length})
                </button>
                <button
                    onClick={() => setActiveTab('recent')}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        activeTab === 'recent'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    Recent ({recentIssues.length})
                </button>
                <button
                    onClick={() => setActiveTab('epics')}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        activeTab === 'epics'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    Epics ({epics.length})
                </button>
                <button
                    onClick={() => setActiveTab('search')}
                    className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        activeTab === 'search'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    Search
                </button>
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
                        disabled={loading || !searchQuery.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
                    >
                        Search
                    </button>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4">
                    <p className="text-red-300 text-sm">{error}</p>
                    <button
                        onClick={handleRefresh}
                        className="mt-2 text-xs text-red-200 hover:text-white underline"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Issues List */}
            <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
                {currentIssues.length === 0 && !loading ? (
                    <div className="text-center py-6 text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 opacity-50">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <circle cx="12" cy="12" r="4"/>
                        </svg>
                        <p className="text-sm">No {activeTab} issues found</p>
                        <p className="text-xs mt-1">
                            {activeTab === 'search' 
                                ? 'Try searching with different keywords'
                                : 'Issues will appear here when available from your Jira instance'
                            }
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {currentIssues.map((issue) => (
                            <div
                                key={issue.id}
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

            {currentIssues.length > 0 && (
                <p className="text-xs text-gray-500 mt-2 text-center">
                    Click on any issue above to link it to a bucket or log time directly
                </p>
            )}
        </div>
    );
}