/**
 * EXAMPLE: How to integrate the Jira Issue Crawler in your settings panel
 *
 * This example shows:
 * 1. Initializing the crawler with Jira settings
 * 2. Triggering initial crawl when projects are selected
 * 3. Displaying crawler status
 * 4. Handling crawler controls
 */

import React, { useEffect, useState } from 'react';
import { useSettings } from './context/SettingsContext';
import { JiraCache } from './services/jiraCache';
import { JiraCrawlerStatus } from './components/JiraCrawlerStatus';

export function JiraSettingsPanel() {
    const { settings, updateSettings } = useSettings();
    const [jiraCache] = useState(() => new JiraCache());
    const [isCrawling, setIsCrawling] = useState(false);

    // Initialize JiraCache when Jira settings change
    useEffect(() => {
        const { jira } = settings;

        if (jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
            console.log('[JiraSettings] Initializing Jira cache with crawler');

            // Initialize both JiraService and Crawler
            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);

            // Set selected projects
            if (jira.selectedProjects?.length) {
                jiraCache.setSelectedProjects(jira.selectedProjects);

                // Auto-start crawl for selected projects (if not already complete)
                const shouldCrawl = jira.selectedProjects.some(
                    projectKey => !jiraCache.crawler?.isProjectComplete(projectKey)
                );

                if (shouldCrawl && jiraCache.isCrawlerEnabled()) {
                    console.log('[JiraSettings] Starting initial crawl for selected projects');
                    setIsCrawling(true);

                    jiraCache.resumeCrawls(jira.selectedProjects)
                        .then(() => {
                            console.log('[JiraSettings] Initial crawl completed');
                            setIsCrawling(false);
                        })
                        .catch(error => {
                            console.error('[JiraSettings] Crawl failed:', error);
                            setIsCrawling(false);
                        });
                }
            }
        }
    }, [settings.jira, jiraCache]);

    const handleProjectSelection = (selectedProjects: string[]) => {
        updateSettings({
            jira: {
                ...settings.jira!,
                selectedProjects
            }
        });
    };

    const handleStartCrawl = async () => {
        if (!settings.jira?.selectedProjects?.length) {
            alert('Please select at least one project first');
            return;
        }

        setIsCrawling(true);
        try {
            await jiraCache.crawlProjects(settings.jira.selectedProjects);
            alert('Crawl completed successfully!');
        } catch (error) {
            console.error('Crawl failed:', error);
            alert('Crawl failed. Check console for details.');
        } finally {
            setIsCrawling(false);
        }
    };

    const handleResetProject = (projectKey: string) => {
        if (confirm(`Reset crawler cache for ${projectKey}? This will require re-crawling.`)) {
            jiraCache.crawler?.resetProject(projectKey);
        }
    };

    return (
        <div className="space-y-6">
            {/* Jira Configuration Section */}
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Jira Configuration</h3>

                {/* ... Your existing Jira settings UI ... */}

                {/* Project Selection */}
                <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Selected Projects
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {['DES', 'BEEM', 'TECH', 'PROD'].map(projectKey => (
                            <label
                                key={projectKey}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-700 rounded cursor-pointer hover:bg-gray-650"
                            >
                                <input
                                    type="checkbox"
                                    checked={settings.jira?.selectedProjects?.includes(projectKey)}
                                    onChange={(e) => {
                                        const currentProjects = settings.jira?.selectedProjects || [];
                                        const newProjects = e.target.checked
                                            ? [...currentProjects, projectKey]
                                            : currentProjects.filter(p => p !== projectKey);
                                        handleProjectSelection(newProjects);
                                    }}
                                    className="rounded"
                                />
                                <span className="text-white font-mono">{projectKey}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Manual Crawl Trigger */}
                <div className="mt-4">
                    <button
                        onClick={handleStartCrawl}
                        disabled={isCrawling || !settings.jira?.selectedProjects?.length}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                    >
                        {isCrawling ? 'Crawling...' : 'Start Manual Crawl'}
                    </button>
                    <p className="mt-2 text-xs text-gray-400">
                        Manually trigger a comprehensive crawl of all selected projects.
                        This will discover all issues, including those not returned by JQL.
                    </p>
                </div>
            </div>

            {/* Crawler Status Section */}
            <JiraCrawlerStatus jiraCache={jiraCache} />

            {/* Crawler Information */}
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-white mb-2">What is the Issue Crawler?</h4>
                <div className="text-xs text-gray-400 space-y-2">
                    <p>
                        The Jira Issue Crawler discovers <strong>all issues</strong> in your projects by
                        systematically checking each issue number (e.g., DES-1, DES-2, DES-3...).
                    </p>
                    <p>
                        <strong>Why is this needed?</strong> Jira's JQL queries are limited to 100 results
                        per request and may miss deleted or restricted issues. The crawler finds everything.
                    </p>
                    <p>
                        <strong>How it works:</strong>
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Starts from a known issue (or issue #1)</li>
                        <li>Crawls upward (DES-230 → DES-231 → DES-232...)</li>
                        <li>Crawls downward (DES-230 → DES-229 → DES-228...)</li>
                        <li>Stops after 50 consecutive 404s (missing issues)</li>
                        <li>Respects rate limits (~5 requests/second)</li>
                        <li>Saves progress automatically (survives app restarts)</li>
                    </ul>
                    <p>
                        <strong>Performance:</strong> A project with 1000 issues takes ~3-4 minutes to crawl initially.
                        Subsequent updates are much faster as only new issues are discovered.
                    </p>
                </div>
            </div>

            {/* Advanced Crawler Controls */}
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-white mb-3">Advanced Controls</h4>

                {/* Per-Project Reset */}
                <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-300">
                        Reset Project Cache
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {settings.jira?.selectedProjects?.map(projectKey => (
                            <button
                                key={projectKey}
                                onClick={() => handleResetProject(projectKey)}
                                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                            >
                                Reset {projectKey}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-gray-500">
                        Clear cached data for a specific project. The crawler will re-discover all issues.
                    </p>
                </div>

                {/* Cache Statistics */}
                <div className="mt-4">
                    <button
                        onClick={() => {
                            const info = jiraCache.getCacheInfo();
                            console.log('Cache Info:', info);
                            alert(JSON.stringify(info, null, 2));
                        }}
                        className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                    >
                        View Cache Statistics (Console)
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * EXAMPLE: Using the crawler in the AssignmentPicker
 *
 * The AssignmentPicker automatically uses crawler data when available.
 * No changes needed - just ensure JiraCache is initialized!
 */

/*
import { AssignmentPicker } from './components/AssignmentPicker';
import { useState } from 'react';

function MyComponent() {
    const [assignment, setAssignment] = useState(null);

    return (
        <AssignmentPicker
            value={assignment}
            onChange={setAssignment}
            placeholder="Select Jira issue or bucket..."
        />
    );
}

// The AssignmentPicker will now show ALL issues from the crawler,
// not just the 100 most recent from JQL!
*/

/**
 * EXAMPLE: Monitoring crawl progress programmatically
 */

/*
import { useEffect, useState } from 'react';
import { JiraCache } from './services/jiraCache';

function CrawlMonitor() {
    const [jiraCache] = useState(() => new JiraCache());
    const [status, setStatus] = useState(null);

    useEffect(() => {
        // Subscribe to real-time crawl updates
        const unsubscribe = jiraCache.onCrawlStatus((crawlStatus) => {
            setStatus(crawlStatus);

            if (crawlStatus.isComplete) {
                console.log(`✓ ${crawlStatus.projectKey} ${crawlStatus.direction} complete!`);
            }
        });

        return unsubscribe;
    }, [jiraCache]);

    if (!status) return null;

    return (
        <div>
            <p>Project: {status.projectKey}</p>
            <p>Direction: {status.direction}</p>
            <p>Current: {status.currentIssueNumber}</p>
            <p>Found: {status.issuesFound}</p>
            <p>404s: {status.consecutive404s}/50</p>
        </div>
    );
}
*/

/**
 * EXAMPLE: Background crawling on app startup
 */

/*
import { useEffect } from 'react';
import { useSettings } from './context/SettingsContext';
import { JiraCache } from './services/jiraCache';

function App() {
    const { settings } = useSettings();
    const [jiraCache] = useState(() => new JiraCache());

    useEffect(() => {
        // On app startup, resume any incomplete crawls
        const { jira } = settings;

        if (jira?.enabled && jira?.selectedProjects?.length) {
            console.log('[App] Resuming background crawls...');

            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);
            jiraCache.setSelectedProjects(jira.selectedProjects);

            // Resume in background (non-blocking)
            jiraCache.resumeCrawls(jira.selectedProjects)
                .then(() => console.log('[App] Background crawls complete'))
                .catch(error => console.error('[App] Background crawl error:', error));
        }
    }, []);

    return <div>Your App</div>;
}
*/
