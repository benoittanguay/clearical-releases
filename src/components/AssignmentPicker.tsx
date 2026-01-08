import { useState, useEffect } from 'react';
import { useStorage, WorkAssignment, TimeBucket } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { JiraCache } from '../services/jiraCache';
import type { JiraIssue } from '../services/jiraService';

interface AssignmentPickerProps {
    value?: WorkAssignment | null;
    onChange: (assignment: WorkAssignment | null) => void;
    placeholder?: string;
    className?: string;
}

export function AssignmentPicker({ value, onChange, placeholder = "Select assignment...", className = "" }: AssignmentPickerProps) {
    const { buckets } = useStorage();
    const { settings } = useSettings();
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
    const [jiraCache] = useState(() => new JiraCache());

    // Initialize Jira cache when settings change
    useEffect(() => {
        const { jira } = settings;
        if (jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);
            if (jira.selectedProjects?.length) {
                jiraCache.setSelectedProjects(jira.selectedProjects);
            }
            // Load assigned issues for the picker
            jiraCache.getAssignedIssues().then(issues => {
                setJiraIssues(issues);
            });
        }
    }, [settings.jira, jiraCache]);

    const handleSelectBucket = (bucket: TimeBucket) => {
        onChange({
            type: 'bucket',
            bucket: {
                id: bucket.id,
                name: bucket.name,
                color: bucket.color
            }
        });
        setSearchQuery('');
        setIsOpen(false);
    };

    const handleSelectJiraIssue = (issue: JiraIssue) => {
        onChange({
            type: 'jira',
            jiraIssue: {
                key: issue.key,
                summary: issue.fields.summary,
                issueType: issue.fields.issuetype.name,
                status: issue.fields.status.name,
                projectKey: issue.fields.project.key,
                projectName: issue.fields.project.name
            }
        });
        setSearchQuery('');
        setIsOpen(false);
    };

    const handleClear = () => {
        onChange(null);
        setSearchQuery('');
        setIsOpen(false);
    };

    // Filter buckets based on search query
    const filteredBuckets = buckets.filter(bucket => 
        bucket.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Filter Jira issues based on search query
    const filteredJiraIssues = jiraIssues.filter(issue => 
        issue.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.fields.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        issue.fields.project.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getDisplayText = () => {
        if (!value) return placeholder;
        
        if (value.type === 'bucket' && value.bucket) {
            return value.bucket.name;
        } else if (value.type === 'jira' && value.jiraIssue) {
            return `${value.jiraIssue.key} - ${value.jiraIssue.summary}`;
        }
        
        return placeholder;
    };

    const getDisplayColor = () => {
        if (value?.type === 'bucket' && value.bucket) {
            return value.bucket.color;
        }
        return '#6b7280'; // Gray color for Jira issues or no selection
    };

    return (
        <div className={`relative ${className}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-700 text-white text-sm rounded hover:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div 
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getDisplayColor() }}
                    />
                    <span className="truncate">{getDisplayText()}</span>
                </div>
                <svg 
                    className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
                    {/* Search input */}
                    <div className="p-2 border-b border-gray-600">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search buckets and issues..."
                            className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                        />
                    </div>
                    
                    <div className="flex-1 overflow-y-auto">
                        {/* Clear option */}
                        <button
                            onClick={handleClear}
                            className="w-full px-3 py-2 text-left text-gray-400 hover:bg-gray-700 text-sm border-b border-gray-600"
                        >
                            <span className="italic">No assignment</span>
                        </button>

                        {/* Manual buckets section */}
                        {filteredBuckets.length > 0 && (
                            <div>
                                <div className="px-3 py-1 text-xs text-gray-500 bg-gray-750 font-medium">
                                    Manual Categories {searchQuery && `(${filteredBuckets.length})`}
                                </div>
                                {filteredBuckets.map((bucket) => (
                                    <button
                                        key={bucket.id}
                                        onClick={() => handleSelectBucket(bucket)}
                                        className="w-full px-3 py-2 text-left hover:bg-gray-700 text-sm flex items-center gap-2"
                                    >
                                        <div 
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: bucket.color }}
                                        />
                                        <span className="text-white">{bucket.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Jira issues section */}
                        {settings.jira?.enabled && filteredJiraIssues.length > 0 && (
                            <div>
                                <div className="px-3 py-1 text-xs text-gray-500 bg-gray-750 font-medium border-t border-gray-600">
                                    Jira Issues {searchQuery && `(${filteredJiraIssues.length})`}
                                </div>
                                {filteredJiraIssues.slice(0, 20).map((issue) => ( // Show more results when searching
                                    <button
                                        key={issue.id}
                                        onClick={() => handleSelectJiraIssue(issue)}
                                        className="w-full px-3 py-2 text-left hover:bg-gray-700 text-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-blue-400 font-mono text-xs">{issue.key}</span>
                                                    <span className="text-xs text-gray-500">{issue.fields.project.name}</span>
                                                </div>
                                                <div className="text-white truncate">{issue.fields.summary}</div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Empty state */}
                        {filteredBuckets.length === 0 && (!settings.jira?.enabled || filteredJiraIssues.length === 0) && (
                            <div className="px-3 py-4 text-center text-gray-500 text-sm">
                                {searchQuery ? 'No assignments match your search' : 'No assignments available'}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Click outside overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 z-40"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </div>
    );
}