import { useState, useEffect } from 'react';
import { useStorage } from '../context/StorageContext';
import type { WorkAssignment, TimeBucket } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useJiraCache } from '../context/JiraCacheContext';
import { analytics } from '../services/analytics';
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
    const { hasFeature } = useSubscription();
    const jiraCache = useJiraCache();
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
    const [selectedProject, setSelectedProject] = useState<string>('all'); // 'all' or specific project key

    const hasJiraAccess = hasFeature('jira');

    // Load Jira issues when settings change
    useEffect(() => {
        const loadJiraIssues = async () => {
            const { jira } = settings;
            if (hasJiraAccess && jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
                try {
                    // Load assigned issues
                    const assignedIssues = await jiraCache.getAssignedIssues();

                    // Also load issues from all selected projects
                    const selectedProjects = jira.selectedProjects || [];
                    const projectIssuesPromises = selectedProjects.map(projectKey =>
                        jiraCache.getProjectIssues(projectKey).catch(() => [])
                    );
                    const projectIssuesArrays = await Promise.all(projectIssuesPromises);

                    // Combine all issues and deduplicate by issue key
                    const allIssues = [...assignedIssues, ...projectIssuesArrays.flat()];
                    const uniqueIssues = allIssues.filter((issue, index, self) =>
                        self.findIndex(i => i.key === issue.key) === index
                    );

                    setJiraIssues(uniqueIssues);
                } catch (error) {
                    console.error('[AssignmentPicker] Failed to load Jira issues:', error);
                    setJiraIssues([]);
                }
            } else {
                setJiraIssues([]);
            }
        };

        loadJiraIssues();
    }, [settings.jira, jiraCache, hasJiraAccess]);

    const handleSelectBucket = (bucket: TimeBucket) => {
        onChange({
            type: 'bucket',
            bucket: {
                id: bucket.id,
                name: bucket.name,
                color: bucket.color
            }
        });
        analytics.track('assignment.selected', { source: 'picker' });
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
        analytics.track('assignment.selected', { source: 'picker' });
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

    // Filter Jira issues based on search query and selected project
    const filteredJiraIssues = jiraIssues.filter(issue => {
        // Filter by search query
        const matchesSearch = issue.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
            issue.fields.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
            issue.fields.project.name.toLowerCase().includes(searchQuery.toLowerCase());

        // Filter by selected project
        const matchesProject = selectedProject === 'all' || issue.fields.project.key === selectedProject;

        return matchesSearch && matchesProject;
    });

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
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm focus:outline-none active:scale-[0.98] transition-all"
                style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-primary)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-body)',
                    transitionDuration: 'var(--duration-base)',
                    transitionTimingFunction: 'var(--ease-out)',
                    boxShadow: 'var(--shadow-sm)'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                    e.currentTarget.style.borderColor = 'var(--color-accent-border)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                    e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                }}
            >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                        className="rounded-full flex-shrink-0 transition-all"
                        style={{
                            width: '12px',
                            height: '12px',
                            backgroundColor: getDisplayColor(),
                            boxShadow: value ? `0 0 12px ${getDisplayColor()}60, 0 2px 8px ${getDisplayColor()}40` : 'none',
                            transitionDuration: 'var(--duration-base)',
                            transitionTimingFunction: 'var(--ease-out)'
                        }}
                    />
                    <span className="truncate font-medium">{getDisplayText()}</span>
                </div>
                <svg
                    className="w-4 h-4 flex-shrink-0 transition-transform"
                    style={{
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        transitionDuration: 'var(--duration-base)',
                        transitionTimingFunction: 'var(--ease-out)',
                        color: 'var(--color-text-secondary)'
                    }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div
                    className="absolute top-full left-0 right-0 z-50 mt-2 rounded-xl max-h-80 overflow-hidden flex flex-col glass animate-scale-in"
                    style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-primary)',
                        borderRadius: 'var(--radius-xl)',
                        boxShadow: 'var(--shadow-xl)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)'
                    }}
                >
                    {/* Search and filter controls */}
                    <div className="p-3 border-b flex gap-2"
                         style={{ borderColor: 'var(--color-border-primary)' }}>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search buckets and issues..."
                            className="flex-1 rounded-lg text-sm px-3 py-2 focus:outline-none transition-all"
                            style={{
                                backgroundColor: 'var(--color-bg-tertiary)',
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
                            autoFocus
                        />
                        {settings.jira?.enabled && settings.jira.selectedProjects && settings.jira.selectedProjects.length > 1 && (
                            <div className="relative flex-shrink-0">
                                <select
                                    value={selectedProject}
                                    onChange={(e) => setSelectedProject(e.target.value)}
                                    className="appearance-none text-sm rounded pl-2 pr-7 py-1 focus:outline-none cursor-pointer transition-all"
                                    style={{
                                        backgroundColor: 'var(--color-bg-tertiary)',
                                        border: '1px solid var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-body)',
                                        transitionDuration: 'var(--duration-base)',
                                        transitionTimingFunction: 'var(--ease-out)',
                                        minWidth: '120px'
                                    }}
                                    onFocus={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                                    }}
                                    onBlur={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <option value="all">All Projects</option>
                                    {settings.jira.selectedProjects.map(projectKey => (
                                        <option key={projectKey} value={projectKey}>{projectKey}</option>
                                    ))}
                                </select>
                                <svg
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                                    style={{ color: 'var(--color-text-secondary)' }}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto">
                        {/* Clear option */}
                        <button
                            onClick={handleClear}
                            className="w-full px-4 py-2.5 text-left text-sm border-b transition-all"
                            style={{
                                color: 'var(--color-text-secondary)',
                                fontFamily: 'var(--font-body)',
                                borderColor: 'var(--color-border-primary)',
                                transitionDuration: 'var(--duration-fast)',
                                transitionTimingFunction: 'var(--ease-out)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                                e.currentTarget.style.color = 'var(--color-text-primary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                        >
                            <span className="italic">No assignment</span>
                        </button>

                        {/* Manual buckets section */}
                        {filteredBuckets.length > 0 && (
                            <div>
                                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                     style={{
                                         color: 'var(--color-text-tertiary)',
                                         backgroundColor: 'var(--color-bg-tertiary)',
                                         fontFamily: 'var(--font-display)'
                                     }}>
                                    Manual Categories {searchQuery && `(${filteredBuckets.length})`}
                                </div>
                                {filteredBuckets.map((bucket) => (
                                    <button
                                        key={bucket.id}
                                        onClick={() => handleSelectBucket(bucket)}
                                        className="w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-all"
                                        style={{
                                            fontFamily: 'var(--font-body)',
                                            transitionDuration: 'var(--duration-fast)',
                                            transitionTimingFunction: 'var(--ease-out)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <div
                                            className="rounded-full flex-shrink-0"
                                            style={{
                                                width: '10px',
                                                height: '10px',
                                                backgroundColor: bucket.color,
                                                boxShadow: `0 0 10px ${bucket.color}50`
                                            }}
                                        />
                                        <span style={{ color: 'var(--color-text-primary)' }}>{bucket.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Jira issues section */}
                        {hasJiraAccess && settings.jira?.enabled && filteredJiraIssues.length > 0 && (
                            <div>
                                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider border-t"
                                     style={{
                                         color: 'var(--color-text-tertiary)',
                                         backgroundColor: 'var(--color-bg-tertiary)',
                                         borderColor: 'var(--color-border-primary)',
                                         fontFamily: 'var(--font-display)'
                                     }}>
                                    Jira Issues {(searchQuery || selectedProject !== 'all') && `(${filteredJiraIssues.length})`}
                                </div>
                                {filteredJiraIssues.slice(0, 20).map((issue) => (
                                    <button
                                        key={issue.id}
                                        onClick={() => handleSelectJiraIssue(issue)}
                                        className="w-full px-4 py-2.5 text-left text-sm transition-all"
                                        style={{
                                            fontFamily: 'var(--font-body)',
                                            transitionDuration: 'var(--duration-fast)',
                                            transitionTimingFunction: 'var(--ease-out)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="rounded-full flex-shrink-0"
                                                 style={{
                                                     width: '10px',
                                                     height: '10px',
                                                     backgroundColor: 'var(--color-accent)',
                                                     boxShadow: '0 0 10px rgba(255, 72, 0, 0.5)'
                                                 }} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-mono text-xs font-semibold" style={{ color: 'var(--color-info)' }}>{issue.key}</span>
                                                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{issue.fields.project.name}</span>
                                                </div>
                                                <div className="truncate" style={{ color: 'var(--color-text-primary)' }}>{issue.fields.summary}</div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Empty state */}
                        {filteredBuckets.length === 0 && (!hasJiraAccess || !settings.jira?.enabled || filteredJiraIssues.length === 0) && (
                            <div className="px-4 py-12 text-center text-sm animate-fade-in"
                                 style={{ color: 'var(--color-text-tertiary)' }}>
                                <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ opacity: 0.5 }}>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p style={{ fontFamily: 'var(--font-body)' }}>
                                    {searchQuery ? 'No assignments match your search' : 'No assignments available'}
                                </p>
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