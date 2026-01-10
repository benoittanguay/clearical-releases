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
}

export interface JiraStatus {
    id: string;
    name: string;
    description: string;
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
        reporter: JiraUser;
        priority?: {
            id: string;
            name: string;
            iconUrl: string;
        };
        created: string;
        updated: string;
        resolutiondate?: string;
        parent?: {
            id: string;
            key: string;
            fields: {
                summary: string;
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

export class JiraService {
    private baseUrl: string;
    private email: string;
    private apiToken: string;
    private lastRequest = 0;
    private readonly REQUEST_DELAY = 100;
    constructor(baseUrl: string, email: string, apiToken: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.email = email;
        this.apiToken = apiToken;
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;
        if (timeSinceLastRequest < this.REQUEST_DELAY) {
            const delay = this.REQUEST_DELAY - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequest = Date.now();
    }

    private async makeRequest<T>(
        endpoint: string, 
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
        body?: any
    ): Promise<T> {
        await this.rateLimit();

        const url = `${this.baseUrl}${endpoint}`;
        const auth = btoa(`${this.email}:${this.apiToken}`);

        const headers = {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        // Use the main process proxy to avoid CORS issues
        // @ts-ignore - window.electron is defined in preload
        if (!window.electron?.ipcRenderer?.jiraApiRequest) {
            throw new Error('Jira API proxy not available. Please restart the application.');
        }

        try {
            const requestStart = Date.now();
            console.log(`[JiraService] 🌐 Making ${method} request to:`, url);
            // @ts-ignore
            const result = await window.electron.ipcRenderer.jiraApiRequest({
                url,
                method,
                headers,
                body: body, // Send raw body object - IPC handler will stringify it
            });

            const requestDuration = Date.now() - requestStart;
            console.log(`[JiraService] ✅ Response received in ${requestDuration}ms:`, { success: result.success, status: result.status });
            
            if (!result.success) {
                if (result.error) {
                    throw new Error(`Network error: ${result.error}`);
                } else {
                    throw new Error(`API error (${result.status}): ${result.statusText}`);
                }
            }

            return result.data;
        } catch (error) {
            console.error('[JiraService] API Error:', error);
            throw error;
        }
    }

    async testConnection(): Promise<boolean> {
        console.log('[JiraService] Testing connection to:', this.baseUrl);
        try {
            const user = await this.getCurrentUser();
            console.log('[JiraService] Connection test successful, user:', user.displayName);
            return true;
        } catch (error) {
            console.error('[JiraService] Connection test failed:', error);
            return false;
        }
    }

    async searchIssues(
        jql: string, 
        startAt: number = 0, 
        maxResults: number = 100
    ): Promise<JiraSearchResponse> {
        const encodedJql = encodeURIComponent(jql);
        const fields = 'summary,status,issuetype,project,assignee,reporter,priority,parent,created,updated,resolutiondate,description';
        
        return this.makeRequest<JiraSearchResponse>(
            `/rest/api/3/search/jql?jql=${encodedJql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`
        );
    }

    async getMyAssignedIssues(maxResults: number = 100): Promise<JiraSearchResponse> {
        const jql = 'assignee = currentUser() ORDER BY updated DESC';
        return this.searchIssues(jql, 0, maxResults);
    }

    async getProjectIssues(projectKey: string, maxResults: number = 100): Promise<JiraSearchResponse> {
        const jql = `project = "${projectKey}" ORDER BY updated DESC`;
        return this.searchIssues(jql, 0, maxResults);
    }

    async searchIssuesByText(searchText: string, maxResults: number = 100): Promise<JiraSearchResponse> {
        const jql = `text ~ "${searchText}" ORDER BY updated DESC`;
        return this.searchIssues(jql, 0, maxResults);
    }

    async getProjects(): Promise<JiraProject[]> {
        return this.makeRequest<JiraProject[]>('/rest/api/3/project');
    }

    async getCurrentUser(): Promise<JiraUser> {
        return this.makeRequest<JiraUser>('/rest/api/3/myself');
    }

    async getIssueTypes(): Promise<JiraIssueType[]> {
        return this.makeRequest<JiraIssueType[]>('/rest/api/3/issuetype');
    }

    async getIssue(issueKeyOrId: string): Promise<JiraIssue> {
        const fields = 'summary,status,issuetype,project,assignee,reporter,priority,parent,created,updated,resolutiondate,description';
        return this.makeRequest<JiraIssue>(
            `/rest/api/3/issue/${issueKeyOrId}?fields=${fields}`
        );
    }

    async getIssueIdFromKey(issueKey: string): Promise<string> {
        const issue = await this.getIssue(issueKey);
        return issue.id;
    }
}