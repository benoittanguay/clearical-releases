export interface TempoWorklog {
    issueId: number; // Numeric Jira issue ID (required in Tempo API v4)
    timeSpentSeconds: number;
    startDate: string; // YYYY-MM-DD format
    startTime?: string; // HH:mm:ss format
    description?: string;
    authorAccountId?: string;
    billableSeconds?: number;
}

export interface TempoWorklogResponse {
    self: string;
    tempoWorklogId: number;
    jiraWorklogId: number;
    issue: {
        self: string;
        key: string;
        id: number;
    };
    timeSpentSeconds: number;
    billableSeconds: number;
    startDate: string;
    startTime: string;
    description: string;
    createdAt: string;
    updatedAt: string;
    author: {
        self: string;
        accountId: string;
        displayName: string;
    };
}

export interface TempoApiError {
    message: string;
    statusCode: number;
    details?: any;
}

export interface JiraIssue {
    id: string;
    key: string;
    self: string;
    fields: {
        summary: string;
        status: {
            name: string;
            statusCategory: {
                key: string;
                colorName: string;
            };
        };
        issuetype: {
            name: string;
            iconUrl?: string;
            subtask: boolean;
        };
        project: {
            key: string;
            name: string;
            avatarUrls?: {
                '16x16'?: string;
                '24x24'?: string;
                '32x32'?: string;
                '48x48'?: string;
            };
        };
        assignee?: {
            displayName: string;
            accountId: string;
            avatarUrls?: {
                '16x16'?: string;
                '24x24'?: string;
                '32x32'?: string;
                '48x48'?: string;
            };
        };
        priority?: {
            name: string;
            iconUrl?: string;
        };
        parent?: {
            id: string;
            key: string;
            fields: {
                summary: string;
                issuetype: {
                    name: string;
                    iconUrl?: string;
                };
            };
        };
    };
}

export interface JiraSearchResponse {
    expand: string;
    startAt: number;
    maxResults: number;
    total: number;
    issues: JiraIssue[];
}

export class TempoService {
    private baseUrl: string;
    private apiToken: string;
    private lastRequestTime: number = 0;
    private requestInterval: number = 1000; // 1 second between requests
    private recentIssueKeysCache: { keys: string[], timestamp: number } | null = null;
    private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes

    constructor(baseUrl: string, apiToken: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiToken = apiToken;
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.requestInterval) {
            const waitTime = this.requestInterval - timeSinceLastRequest;
            console.log(`[TempoService] Rate limiting: waiting ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }

    private async makeRequest<T>(
        endpoint: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
        body?: any
    ): Promise<T> {
        // Apply rate limiting
        await this.rateLimit();
        
        const url = `${this.baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
        };

        const config: RequestInit = {
            method,
            headers,
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(body);
        }

        try {
            console.log('[TempoService] Making request to:', url);
            console.log('[TempoService] Request config:', { method, headers: { ...headers, Authorization: 'Bearer ***' } });
            
            // Use the main process proxy to avoid CORS issues
            // @ts-ignore - window.electron is defined in preload
            if (!window.electron?.ipcRenderer?.tempoApiRequest) {
                throw new Error('Tempo API proxy not available. Please restart the application.');
            }

            // @ts-ignore
            const result = await window.electron.ipcRenderer.tempoApiRequest({
                url,
                method,
                headers,
                body,
            });
            
            console.log('[TempoService] Proxy response:', result);
            
            if (!result.success) {
                if (result.error) {
                    throw new Error(`Network error: ${result.error}`);
                } else {
                    const errorMessage = result.data?.message || result.statusText || 'Unknown error';
                    throw new Error(`Tempo API Error: ${result.status} - ${errorMessage}`);
                }
            }

            console.log('[TempoService] Success response received');
            return result.data || null;
        } catch (error) {
            console.error('[TempoService] Request failed:', error);
            if (error instanceof Error) {
                if (error.message.includes('Network error')) {
                    throw new Error('Network error: Unable to connect to Tempo API. Check your internet connection and base URL.');
                }
                if (error.message.includes('429')) {
                    throw new Error('Rate limit exceeded. Please wait a moment before trying again.');
                }
                if (error.message.includes('401')) {
                    throw new Error('Authentication failed: Please check your API token and base URL in settings.');
                }
            }
            throw error;
        }
    }

    /**
     * Test the API connection and authentication
     */
    async testConnection(): Promise<boolean> {
        try {
            // Use a simple GET request to test authentication
            const response = await this.makeRequest('/4/worklogs?limit=1');
            console.log('[TempoService] Connection test response:', JSON.stringify(response, null, 2));
            return true;
        } catch (error) {
            console.error('Tempo connection test failed:', error);
            return false;
        }
    }

    /**
     * Create a worklog entry in Tempo
     */
    async createWorklog(worklog: TempoWorklog): Promise<TempoWorklogResponse> {
        return this.makeRequest<TempoWorklogResponse>('/4/worklogs', 'POST', worklog);
    }

    /**
     * Get worklogs for a date range
     */
    async getWorklogs(
        from: string, // YYYY-MM-DD
        to: string,   // YYYY-MM-DD
        limit: number = 50
    ): Promise<TempoWorklogResponse[]> {
        const endpoint = `/4/worklogs?from=${from}&to=${to}&limit=${limit}`;
        const response = await this.makeRequest<{ results: TempoWorklogResponse[] }>(endpoint);
        console.log('[TempoService] getWorklogs raw response:', JSON.stringify(response, null, 2));
        console.log('[TempoService] getWorklogs results length:', response?.results?.length || 0);
        return response.results || [];
    }

    /**
     * Update an existing worklog
     */
    async updateWorklog(
        worklogId: number,
        updates: Partial<TempoWorklog>
    ): Promise<TempoWorklogResponse> {
        return this.makeRequest<TempoWorklogResponse>(`/4/worklogs/${worklogId}`, 'PUT', updates);
    }

    /**
     * Delete a worklog
     */
    async deleteWorklog(worklogId: number): Promise<void> {
        await this.makeRequest(`/4/worklogs/${worklogId}`, 'DELETE');
    }

    /**
     * Validate a Jira issue key by trying to log time to it
     * This is the most reliable way to check if an issue exists and is accessible
     * Note: This requires a JiraService instance to convert the issue key to an ID
     */
    async validateIssueKey(issueKey: string, jiraService: any): Promise<{ valid: boolean; error?: string }> {
        try {
            // First get the numeric issue ID from Jira
            const issueId = await jiraService.getIssueIdFromKey(issueKey);

            // Try to create a 1-second worklog as a validation (we'll delete it immediately)
            const testWorklog = {
                issueId: parseInt(issueId, 10),
                timeSpentSeconds: 1, // Minimum time
                startDate: new Date().toISOString().split('T')[0],
                startTime: '09:00:00',
                description: 'TimePortal validation test - please ignore',
            };

            const result = await this.createWorklog(testWorklog);

            // If successful, delete the test worklog immediately
            if (result.tempoWorklogId) {
                try {
                    await this.deleteWorklog(result.tempoWorklogId);
                } catch (deleteError) {
                    console.warn('[TempoService] Could not delete validation worklog:', deleteError);
                }
            }

            return { valid: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return { valid: false, error: errorMessage };
        }
    }

    /**
     * Get recently used issue keys from worklog history (cached)
     */
    async getRecentIssueKeys(days: number = 30): Promise<string[]> {
        try {
            // Check cache first
            const now = Date.now();
            if (this.recentIssueKeysCache && (now - this.recentIssueKeysCache.timestamp) < this.cacheExpiry) {
                console.log('[TempoService] Returning cached recent issue keys');
                return this.recentIssueKeysCache.keys;
            }

            console.log('[TempoService] Cache miss or expired, fetching recent issue keys');
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            console.log('[TempoService] Fetching worklogs from', startDate, 'to', endDate);
            const worklogs = await this.getWorklogs(startDate, endDate, 100);
            
            console.log('[TempoService] Received worklogs:', worklogs.length, 'entries');
            console.log('[TempoService] First few worklogs:', JSON.stringify(worklogs.slice(0, 3), null, 2));
            
            // Extract unique issue keys from recent worklogs
            const issueKeys = new Set<string>();
            worklogs.forEach(worklog => {
                console.log('[TempoService] Processing worklog:', {
                    id: worklog.tempoWorklogId,
                    issue: worklog.issue,
                    description: worklog.description
                });
                if (worklog.issue?.key) {
                    issueKeys.add(worklog.issue.key);
                    console.log('[TempoService] Added issue key:', worklog.issue.key);
                }
            });
            
            const keys = Array.from(issueKeys).slice(0, 20); // Return up to 20 recent issue keys
            console.log('[TempoService] Final issue keys:', keys);
            
            // Cache the result
            this.recentIssueKeysCache = {
                keys,
                timestamp: now
            };
            
            return keys;
        } catch (error) {
            console.error('[TempoService] Failed to get recent issue keys:', error);
            return [];
        }
    }

    /**
     * Get detailed issue information from Tempo worklogs
     * This extracts unique issue keys and constructs issue objects from worklog data
     */
    async getIssuesFromWorklogs(days: number = 365): Promise<JiraIssue[]> {
        try {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            console.log('[TempoService] Fetching worklogs from', startDate, 'to', endDate);
            
            // First try to get recent worklogs without date restrictions
            console.log('[TempoService] Trying to get recent worklogs without date filter...');
            const recentWorklogs = await this.makeRequest<{ results: TempoWorklogResponse[] }>('/4/worklogs?limit=50');
            console.log('[TempoService] Recent worklogs response:', JSON.stringify(recentWorklogs, null, 2));
            
            let worklogs = recentWorklogs.results || [];
            
            // If no recent worklogs, try the date range
            if (worklogs.length === 0) {
                console.log('[TempoService] No recent worklogs, trying date range...');
                worklogs = await this.getWorklogs(startDate, endDate, 200);
            }
            
            console.log('[TempoService] Received worklogs:', worklogs.length, 'entries');
            console.log('[TempoService] Raw worklog response:', JSON.stringify(worklogs, null, 2));
            
            // Group worklogs by issue key and create issue objects
            const issueMap = new Map<string, JiraIssue>();
            
            worklogs.forEach(worklog => {
                if (worklog.issue?.key) {
                    const issueKey = worklog.issue.key;
                    
                    // If we don't have this issue yet, create a basic issue object
                    if (!issueMap.has(issueKey)) {
                        // Create a basic issue object based on available worklog data
                        const issue: JiraIssue = {
                            id: worklog.issue.id.toString(),
                            key: issueKey,
                            self: worklog.issue.self,
                            fields: {
                                summary: `Issue ${issueKey}`, // Default summary, will be updated if we have more data
                                status: {
                                    name: 'Unknown',
                                    statusCategory: {
                                        key: 'indeterminate',
                                        colorName: 'yellow'
                                    }
                                },
                                issuetype: {
                                    name: 'Task', // Default issue type
                                    subtask: false
                                },
                                project: {
                                    key: issueKey.split('-')[0] || 'UNKNOWN',
                                    name: issueKey.split('-')[0] || 'Unknown Project'
                                },
                                assignee: worklog.author ? {
                                    displayName: worklog.author.displayName,
                                    accountId: worklog.author.accountId
                                } : undefined
                            }
                        };
                        issueMap.set(issueKey, issue);
                    }
                }
            });
            
            const issues = Array.from(issueMap.values());
            console.log('[TempoService] Extracted', issues.length, 'unique issues from worklogs');
            
            // If no issues found from worklogs, provide sample issues for demonstration
            if (issues.length === 0) {
                console.log('[TempoService] No worklogs found, providing sample issues for demonstration');
                const sampleIssues: JiraIssue[] = [
                    {
                        id: 'sample-1',
                        key: 'PROJ-123',
                        self: 'https://sample.atlassian.net/rest/api/2/issue/sample-1',
                        fields: {
                            summary: 'Sample Development Task',
                            status: {
                                name: 'In Progress',
                                statusCategory: {
                                    key: 'indeterminate',
                                    colorName: 'yellow'
                                }
                            },
                            issuetype: {
                                name: 'Task',
                                subtask: false
                            },
                            project: {
                                key: 'PROJ',
                                name: 'Sample Project'
                            },
                            assignee: {
                                displayName: 'John Developer',
                                accountId: 'sample-account-1'
                            }
                        }
                    },
                    {
                        id: 'sample-2',
                        key: 'PROJ-456',
                        self: 'https://sample.atlassian.net/rest/api/2/issue/sample-2',
                        fields: {
                            summary: 'Fix Critical Bug in Login System',
                            status: {
                                name: 'To Do',
                                statusCategory: {
                                    key: 'new',
                                    colorName: 'blue'
                                }
                            },
                            issuetype: {
                                name: 'Bug',
                                subtask: false
                            },
                            project: {
                                key: 'PROJ',
                                name: 'Sample Project'
                            },
                            assignee: {
                                displayName: 'Jane QA',
                                accountId: 'sample-account-2'
                            }
                        }
                    },
                    {
                        id: 'sample-3',
                        key: 'EPIC-789',
                        self: 'https://sample.atlassian.net/rest/api/2/issue/sample-3',
                        fields: {
                            summary: 'Q1 2026 User Experience Improvements',
                            status: {
                                name: 'Done',
                                statusCategory: {
                                    key: 'done',
                                    colorName: 'green'
                                }
                            },
                            issuetype: {
                                name: 'Epic',
                                subtask: false
                            },
                            project: {
                                key: 'EPIC',
                                name: 'UX Improvements'
                            },
                            assignee: {
                                displayName: 'Sarah PM',
                                accountId: 'sample-account-3'
                            }
                        }
                    }
                ];
                return sampleIssues;
            }
            
            return issues;
        } catch (error) {
            console.error('[TempoService] Failed to get issues from worklogs:', error);
            return [];
        }
    }

    /**
     * Get my assigned issues (simulated from recent worklogs)
     */
    async getMyAssignedIssues(maxResults: number = 50): Promise<JiraSearchResponse> {
        console.log('[TempoService] getMyAssignedIssues called');
        
        const issues = await this.getIssuesFromWorklogs(30);
        
        // Filter to issues that might be assigned to current user (those they've logged time to recently)
        const filteredIssues = issues.slice(0, maxResults);
        
        console.log('[TempoService] getMyAssignedIssues returning', filteredIssues.length, 'issues');
        
        return {
            expand: '',
            startAt: 0,
            maxResults: filteredIssues.length,
            total: filteredIssues.length,
            issues: filteredIssues
        };
    }

    /**
     * Get recent issues from worklogs
     */
    async getMyRecentIssues(maxResults: number = 20): Promise<JiraSearchResponse> {
        const issues = await this.getIssuesFromWorklogs(14); // Last 2 weeks
        
        const recentIssues = issues.slice(0, maxResults);
        
        return {
            expand: '',
            startAt: 0,
            maxResults: recentIssues.length,
            total: recentIssues.length,
            issues: recentIssues
        };
    }

    /**
     * Get epics (simulate by filtering issues that might be epics)
     */
    async getAvailableEpics(maxResults: number = 30): Promise<JiraSearchResponse> {
        const issues = await this.getIssuesFromWorklogs(60);
        
        // Filter to issues that might be epics (simple heuristic: longer project prefixes or certain keywords)
        const possibleEpics = issues.filter(issue => {
            const key = issue.key.toLowerCase();
            return key.includes('epic') || key.includes('ep-') || issue.fields.project.key.length > 4;
        }).slice(0, maxResults);
        
        // Mark them as epics
        possibleEpics.forEach(issue => {
            issue.fields.issuetype.name = 'Epic';
        });
        
        return {
            expand: '',
            startAt: 0,
            maxResults: possibleEpics.length,
            total: possibleEpics.length,
            issues: possibleEpics
        };
    }

    /**
     * Search issues by text (search through cached worklog issues)
     */
    async searchIssuesByText(searchText: string, maxResults: number = 30): Promise<JiraSearchResponse> {
        const issues = await this.getIssuesFromWorklogs(90);
        
        const searchLower = searchText.toLowerCase();
        const filteredIssues = issues.filter(issue => 
            issue.key.toLowerCase().includes(searchLower) ||
            issue.fields.summary.toLowerCase().includes(searchLower) ||
            issue.fields.project.name.toLowerCase().includes(searchLower)
        ).slice(0, maxResults);
        
        return {
            expand: '',
            startAt: 0,
            maxResults: filteredIssues.length,
            total: filteredIssues.length,
            issues: filteredIssues
        };
    }

    /**
     * Clear cached data (useful for testing or when settings change)
     */
    clearCache(): void {
        console.log('[TempoService] Clearing cache');
        this.recentIssueKeysCache = null;
    }

    /**
     * Convert TimePortal duration (milliseconds) to Tempo format (seconds)
     */
    static durationMsToSeconds(durationMs: number): number {
        return Math.round(durationMs / 1000);
    }

    /**
     * Format date for Tempo API (YYYY-MM-DD)
     */
    static formatDate(timestamp: number): string {
        return new Date(timestamp).toISOString().split('T')[0];
    }

    /**
     * Format time for Tempo API (HH:mm:ss)
     */
    static formatTime(timestamp: number): string {
        return new Date(timestamp).toISOString().split('T')[1].split('.')[0];
    }
}