import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { TempoService } from '../services/tempoService';
import type { JiraIssue, JiraSearchResponse } from '../services/tempoService';
import type { LinkedJiraIssue } from '../context/StorageContext';

interface JiraIssueBrowserProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectIssue: (issue: LinkedJiraIssue) => void;
}

export function JiraIssueBrowser({ isOpen, onClose, onSelectIssue }: JiraIssueBrowserProps) {
    const { settings } = useSettings();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'recent' | 'search' | 'epics'>('recent');
    const [issues, setIssues] = useState<JiraIssue[]>([]);

    const tempoService = settings.tempo?.enabled && settings.tempo?.apiToken 
        ? new TempoService(settings.tempo.baseUrl!, settings.tempo.apiToken)
        : null;

    const loadIssues = async (type: 'recent' | 'search' | 'epics', query?: string) => {
        if (!tempoService) return;

        setLoading(true);
        setError(null);

        try {
            let response: JiraSearchResponse;

            switch (type) {
                case 'recent':
                    response = await tempoService.getMyRecentIssues(20);
                    break;
                case 'epics':
                    response = await tempoService.getAvailableEpics(30);
                    break;
                case 'search':
                    if (query && query.trim()) {
                        response = await tempoService.searchIssuesByText(query.trim());
                    } else {
                        response = await tempoService.getMyRecentIssues(30);
                    }
                    break;
                default:
                    return;
            }

            setIssues(response.issues);
        } catch (err) {
            console.error('Failed to load issues:', err);
            setError(err instanceof Error ? err.message : 'Failed to load issues');
            setIssues([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && tempoService) {
            loadIssues(activeTab, searchQuery);
        }
    }, [isOpen, activeTab, tempoService]);

    const handleSearch = () => {
        if (searchQuery.trim()) {
            loadIssues('search', searchQuery);
        }
    };

    const handleSelectIssue = (issue: JiraIssue) => {
        const linkedIssue: LinkedJiraIssue = {
            key: issue.key,
            summary: issue.fields.summary,
            issueType: issue.fields.issuetype.name,
            status: issue.fields.status.name,
            projectKey: issue.fields.project.key,
            projectName: issue.fields.project.name,
        };
        onSelectIssue(linkedIssue);
        onClose();
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

    if (!isOpen) return null;

    if (!tempoService) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
                    <h3 className="text-lg font-semibold text-white mb-4">Tempo Integration Required</h3>
                    <p className="text-gray-300 mb-4">
                        Please enable and configure Tempo integration in Settings to browse Jira issues.
                    </p>
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl mx-4 max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-white">Select Jira Issue</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex space-x-1 mb-4">
                    <button
                        onClick={() => setActiveTab('recent')}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            activeTab === 'recent'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        My Recent
                    </button>
                    <button
                        onClick={() => setActiveTab('epics')}
                        className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                            activeTab === 'epics'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        Epics
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
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
                        >
                            Search
                        </button>
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span className="ml-2 text-gray-300">Loading issues...</span>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="bg-red-900/50 border border-red-700 rounded p-3 mb-4">
                        <p className="text-red-300 text-sm">{error}</p>
                        <button
                            onClick={() => loadIssues(activeTab, searchQuery)}
                            className="mt-2 text-xs text-red-200 hover:text-white underline"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Issues List */}
                {!loading && !error && (
                    <div className="flex-1 overflow-y-auto">
                        {issues.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                No issues found.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {issues.map((issue) => (
                                    <div
                                        key={issue.id}
                                        onClick={() => handleSelectIssue(issue)}
                                        className="bg-gray-900 border border-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-700 transition-colors"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-blue-400 font-mono text-sm">
                                                        {issue.key}
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        {issue.fields.project.name}
                                                    </span>
                                                </div>
                                                <h4 className="text-white font-medium text-sm mb-2 line-clamp-2">
                                                    {issue.fields.summary}
                                                </h4>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-400">
                                                        {issue.fields.issuetype.name}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded text-xs ${getStatusColor(issue.fields.status.statusCategory.key)}`}>
                                                        {issue.fields.status.name}
                                                    </span>
                                                    {issue.fields.assignee && (
                                                        <span className="text-xs text-gray-400">
                                                            Assigned to {issue.fields.assignee.displayName}
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
                )}
            </div>
        </div>
    );
}