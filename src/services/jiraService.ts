export interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress: string;
    avatarUrls: {
        '16x16': string;
        '24x24': string;
        '32x32': string;
        '48x48': string;
    };
}

export interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    avatarUrls: {
        '16x16': string;
        '24x24': string;
        '32x32': string;
        '48x48': string;
    };
}

export interface JiraIssueType {
    id: string;
    name: string;
    description: string;
    iconUrl: string;
    subtask: boolean;
    hierarchyLevel: number;
}

export interface JiraStatus {
    id: string;
    name: string;
    statusCategory: {
        id: number;
        key: string;
        colorName: string;
        name: string;
    };
}

export interface JiraIssue {
    id: string;
    key: string;
    self: string;
    fields: {
        summary: string;
        description?: string;
        status: JiraStatus;
        issuetype: JiraIssueType;
        project: JiraProject;
        assignee?: JiraUser;
        reporter?: JiraUser;
        priority?: {
            id: string;
            name: string;
            iconUrl: string;
        };
        parent?: {
            id: string;
            key: string;
            fields: {
                summary: string;
                issuetype: JiraIssueType;
            };
        };
        created: string;
        updated: string;
        resolutiondate?: string;
    };
}

export interface JiraSearchResponse {
    expand: string;
    startAt: number;
    maxResults: number;
    total: number;
    issues: JiraIssue[];
}

export interface JiraApiError {
    message: string;
    statusCode: number;
    details?: any;
}

export class JiraService {
    private baseUrl: string;
    private email: string;
    private apiToken: string;
    private lastRequestTime: number = 0;
    private requestInterval: number = 1000; // 1 second between requests

    constructor(baseUrl: string, email: string, apiToken: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.email = email;
        this.apiToken = apiToken;
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.requestInterval) {
            const waitTime = this.requestInterval - timeSinceLastRequest;
            console.log(`[JiraService] Rate limiting: waiting ${waitTime}ms`);
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
        
        const url = `${this.baseUrl}/rest/api/3${endpoint}`;
        
        // Create basic auth header
        const auth = btoa(`${this.email}:${this.apiToken}`);
        
        const headers: Record<string, string> = {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const config: RequestInit = {
            method,
            headers,
        };

        if (body && (method === 'POST' || method === 'PUT')) {
            config.body = JSON.stringify(body);
        }

        try {
            console.log('[JiraService] Making request to:', url);
            console.log('[JiraService] Request config:', { method, headers: { ...headers, Authorization: 'Basic ***' } });
            
            // Use the main process proxy to avoid CORS issues
            // @ts-ignore - window.electron is defined in preload
            if (!window.electron?.ipcRenderer?.jiraApiRequest) {
                throw new Error('Jira API proxy not available. Please restart the application.');
            }

            // @ts-ignore
            const result = await window.electron.ipcRenderer.jiraApiRequest({
                url,
                method,
                headers,
                body,
            });
            
            console.log('[JiraService] Proxy response:', result);
            
            if (!result.success) {
                if (result.error) {
                    throw new Error(`Network error: ${result.error}`);
                } else {
                    const errorMessage = result.data?.message || result.statusText || 'Unknown error';
                    throw new Error(`Jira API Error: ${result.status} - ${errorMessage}`);
                }
            }

            console.log('[JiraService] Success response received');
            return result.data || null;
        } catch (error) {
            console.error('[JiraService] Request failed:', error);
            if (error instanceof Error) {
                if (error.message.includes('Network error')) {
                    throw new Error('Network error: Unable to connect to Jira API. Check your internet connection and base URL.');
                }
                if (error.message.includes('401')) {
                    throw new Error('Authentication failed: Please check your email and API token in settings.');
                }
                if (error.message.includes('403')) {
                    throw new Error('Permission denied: Your account may not have access to this Jira instance.');
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
            await this.makeRequest('/myself');
            return true;
        } catch (error) {
            console.error('Jira connection test failed:', error);
            return false;
        }
    }

    /**
     * Search for issues using JQL
     */
    async searchIssues(
        jql: string, 
        startAt: number = 0, 
        maxResults: number = 50,
        fields?: string[]
    ): Promise<JiraSearchResponse> {
        const params = new URLSearchParams({
            jql,
            startAt: startAt.toString(),
            maxResults: maxResults.toString(),
        });

        if (fields && fields.length > 0) {
            params.append('fields', fields.join(','));
        } else {
            params.append('fields', 'summary,status,issuetype,project,assignee,reporter,priority,parent,created,updated,resolutiondate,description');
        }
        
        return this.makeRequest<JiraSearchResponse>(`/search/jql?${params.toString()}`);
    }

    /**
     * Get all issues using pagination to fetch everything
     */
    async getAllIssuesPaginated(jql: string, batchSize: number = 100): Promise<JiraSearchResponse> {
        const allIssues: JiraIssue[] = [];
        let startAt = 0;
        let total = 0;
        
        do {
            const response = await this.searchIssues(jql, startAt, batchSize);
            allIssues.push(...response.issues);
            total = response.total;
            startAt += response.maxResults;
            
            // Log progress for user feedback
            console.log(`[JiraService] Fetched ${allIssues.length} of ${total} issues`);
            
        } while (allIssues.length < total && startAt < total);
        
        return {
            expand: '',
            startAt: 0,
            maxResults: allIssues.length,
            total: total,
            issues: allIssues
        };
    }

    /**
     * Get issues assigned to current user
     */
    async getMyAssignedIssues(maxResults: number = 50): Promise<JiraSearchResponse> {
        if (maxResults === -1) {
            // Fetch all assigned issues
            return this.getAllIssuesPaginated('assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC');
        }
        return this.searchIssues('assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC', 0, maxResults);
    }

    /**
     * Get recent issues (assigned to or reported by current user)
     */
    async getMyRecentIssues(maxResults: number = 50): Promise<JiraSearchResponse> {
        if (maxResults === -1) {
            // Fetch all recent issues
            return this.getAllIssuesPaginated('(assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC');
        }
        return this.searchIssues('(assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC', 0, maxResults);
    }

    /**
     * Get all unresolved epics
     */
    async getAvailableEpics(maxResults: number = 50): Promise<JiraSearchResponse> {
        if (maxResults === -1) {
            // Fetch all epics
            return this.getAllIssuesPaginated('issuetype = Epic AND resolution = Unresolved ORDER BY updated DESC');
        }
        return this.searchIssues('issuetype = Epic AND resolution = Unresolved ORDER BY updated DESC', 0, maxResults);
    }

    /**
     * Search issues by text
     */
    async searchIssuesByText(searchText: string, maxResults: number = 50): Promise<JiraSearchResponse> {
        const escapedText = searchText.replace(/"/g, '\\"');
        const jql = `(summary ~ "${escapedText}" OR description ~ "${escapedText}" OR key ~ "${escapedText}") ORDER BY updated DESC`;
        return this.searchIssues(jql, 0, maxResults);
    }

    /**
     * Get all projects accessible to the user
     */
    async getProjects(): Promise<JiraProject[]> {
        return this.makeRequest<JiraProject[]>('/project');
    }

    /**
     * Get current user information
     */
    async getCurrentUser(): Promise<JiraUser> {
        return this.makeRequest<JiraUser>('/myself');
    }

    /**
     * Get all issue types
     */
    async getIssueTypes(): Promise<JiraIssueType[]> {
        return this.makeRequest<JiraIssueType[]>('/issuetype');
    }
}