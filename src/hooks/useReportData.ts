import { useMemo } from 'react';
import type { TimeEntry, TimeBucket } from '../types/shared';

export interface BucketBreakdown {
    bucketId: string | null;
    bucketName: string;
    chartLabel: string; // Short label for chart axis (e.g. "DES-380" instead of full name)
    bucketColor: string;
    totalTime: number;
    entryCount: number;
    percentage: number;
}

export interface DailyData {
    date: string; // YYYY-MM-DD
    total: number;
    byBucket: Record<string, number>;
}

export interface AppUsageData {
    appName: string;
    totalTime: number;
    percentage: number;
}

export interface HourlyData {
    hour: number;
    totalTime: number;
}

export interface FocusSession {
    appName: string;
    duration: number;
    bucketName: string;
    bucketColor: string;
}

export interface MeetingData {
    entryId: string;
    date: number;
    duration: number;
    wordCount: number;
    transcriptionCount: number;
}

export interface ReportData {
    // Summary
    totalTime: number;
    avgDaily: number;
    totalEntries: number;
    uniqueDays: number;
    mostUsedApp: string | null;
    meetingTime: number;
    focusScore: number;

    // By bucket
    bucketBreakdowns: BucketBreakdown[];

    // Daily trend
    dailyData: DailyData[];
    bucketNames: string[];
    bucketColors: Record<string, string>;

    // App usage
    appUsage: AppUsageData[];

    // Productivity
    hourlyData: HourlyData[];
    focusSessions: FocusSession[];
    contextSwitchesPerHour: number;
    focusRatio: number;

    // Meetings
    meetings: MeetingData[];
    totalMeetingTime: number;
    totalMeetingCount: number;
    avgMeetingDuration: number;
    totalTranscriptionWords: number;
}

// Generate a deterministic color from a string (for Jira issues)
function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = ((hash % 360) + 360) % 360;
    return `hsl(${hue}, 55%, 50%)`;
}

export function useReportData(entries: TimeEntry[], buckets: TimeBucket[]): ReportData {
    return useMemo(() => {
        const bucketMap = new Map<string, TimeBucket>();
        for (const b of buckets) {
            bucketMap.set(b.id, b);
        }

        // Summary accumulators
        let totalTime = 0;
        const daysSet = new Set<string>();
        const assignmentTimeMap = new Map<string, { time: number; count: number }>();
        const appTimeMap = new Map<string, number>();
        const hourlyTime = new Array(24).fill(0);
        const dailyMap = new Map<string, { total: number; byBucket: Record<string, number> }>();
        let totalContextSwitches = 0;
        let totalActivityTime = 0;

        // Track Jira issue metadata for display
        const jiraIssueInfo = new Map<string, { key: string; summary: string; color: string }>();

        // Focus session tracking
        const allActivitySessions: { appName: string; duration: number; timestamp: number; bucketId: string | null }[] = [];

        // Meeting tracking
        const meetings: MeetingData[] = [];
        let totalMeetingTime = 0;
        let totalTranscriptionWords = 0;

        for (const entry of entries) {
            totalTime += entry.duration;

            const dateStr = new Date(entry.startTime).toISOString().split('T')[0];
            daysSet.add(dateStr);

            // Assignment breakdown — handle both bucket and jira assignments
            let assignmentKey: string;
            let assignmentName: string;

            if (entry.assignment?.type === 'jira' && entry.assignment.jiraIssue) {
                const issue = entry.assignment.jiraIssue;
                assignmentKey = `jira:${issue.key}`;
                assignmentName = `${issue.key} - ${issue.summary}`;
                if (!jiraIssueInfo.has(assignmentKey)) {
                    jiraIssueInfo.set(assignmentKey, {
                        key: issue.key,
                        summary: issue.summary,
                        color: stringToColor(issue.key),
                    });
                }
            } else if (entry.linkedJiraIssue) {
                const issue = entry.linkedJiraIssue;
                assignmentKey = `jira:${issue.key}`;
                assignmentName = `${issue.key} - ${issue.summary}`;
                if (!jiraIssueInfo.has(assignmentKey)) {
                    jiraIssueInfo.set(assignmentKey, {
                        key: issue.key,
                        summary: issue.summary,
                        color: stringToColor(issue.key),
                    });
                }
            } else {
                assignmentKey = entry.assignment?.bucket?.id || entry.bucketId || '__unassigned__';
                assignmentName = entry.assignment?.bucket?.name
                    || (entry.bucketId ? bucketMap.get(entry.bucketId)?.name : null)
                    || 'Unassigned';
            }

            const existing = assignmentTimeMap.get(assignmentKey) || { time: 0, count: 0 };
            existing.time += entry.duration;
            existing.count += 1;
            assignmentTimeMap.set(assignmentKey, existing);

            // Daily trend
            const dailyEntry = dailyMap.get(dateStr) || { total: 0, byBucket: {} };
            dailyEntry.total += entry.duration;
            dailyEntry.byBucket[assignmentName] = (dailyEntry.byBucket[assignmentName] || 0) + entry.duration;
            dailyMap.set(dateStr, dailyEntry);

            // Window activities
            if (entry.windowActivity && entry.windowActivity.length > 0) {
                let prevAppName: string | null = null;
                for (const activity of entry.windowActivity) {
                    // App usage
                    const appTime = appTimeMap.get(activity.appName) || 0;
                    appTimeMap.set(activity.appName, appTime + activity.duration);

                    // Hourly distribution
                    const activityHour = new Date(activity.timestamp).getHours();
                    hourlyTime[activityHour] += activity.duration;

                    // Context switches
                    if (prevAppName !== null && prevAppName !== activity.appName) {
                        totalContextSwitches++;
                    }
                    prevAppName = activity.appName;
                    totalActivityTime += activity.duration;

                    // Collect for focus session analysis
                    allActivitySessions.push({
                        appName: activity.appName,
                        duration: activity.duration,
                        timestamp: activity.timestamp,
                        bucketId: entry.assignment?.bucket?.id || entry.bucketId || null,
                    });
                }
            }

            // Meetings (entries with transcriptions)
            const transcriptions = entry.transcriptions || (entry.transcription ? [entry.transcription] : []);
            if (transcriptions.length > 0) {
                let entryWordCount = 0;
                for (const t of transcriptions) {
                    entryWordCount += t.wordCount || 0;
                }
                meetings.push({
                    entryId: entry.id,
                    date: entry.startTime,
                    duration: entry.duration,
                    wordCount: entryWordCount,
                    transcriptionCount: transcriptions.length,
                });
                totalMeetingTime += entry.duration;
                totalTranscriptionWords += entryWordCount;
            }
        }

        // Compute summaries
        const uniqueDays = daysSet.size;
        const avgDaily = uniqueDays > 0 ? totalTime / uniqueDays : 0;

        // Most used app
        let mostUsedApp: string | null = null;
        let maxAppTime = 0;
        for (const [app, time] of appTimeMap) {
            if (time > maxAppTime) {
                maxAppTime = time;
                mostUsedApp = app;
            }
        }

        // Assignment breakdowns (buckets + Jira issues)
        const bucketBreakdowns: BucketBreakdown[] = [];
        for (const [key, data] of assignmentTimeMap) {
            let name = 'Unassigned';
            let shortLabel = 'Unassigned';
            let color = '#9CA3AF';
            if (key.startsWith('jira:')) {
                const jiraInfo = jiraIssueInfo.get(key);
                if (jiraInfo) {
                    name = `${jiraInfo.key} - ${jiraInfo.summary}`;
                    shortLabel = jiraInfo.key;
                    color = jiraInfo.color;
                }
            } else if (key !== '__unassigned__') {
                const bucket = bucketMap.get(key);
                if (bucket) {
                    name = bucket.name;
                    shortLabel = bucket.name;
                    color = bucket.color;
                } else {
                    // Try assignment bucket info from entries
                    const matchingEntry = entries.find(e =>
                        (e.assignment?.bucket?.id === key) || e.bucketId === key
                    );
                    if (matchingEntry?.assignment?.bucket) {
                        name = matchingEntry.assignment.bucket.name;
                        shortLabel = matchingEntry.assignment.bucket.name;
                        color = matchingEntry.assignment.bucket.color;
                    }
                }
            }
            bucketBreakdowns.push({
                bucketId: key === '__unassigned__' ? null : key,
                bucketName: name,
                chartLabel: shortLabel,
                bucketColor: color,
                totalTime: data.time,
                entryCount: data.count,
                percentage: totalTime > 0 ? (data.time / totalTime) * 100 : 0,
            });
        }
        bucketBreakdowns.sort((a, b) => b.totalTime - a.totalTime);

        // Daily data (sorted by date)
        const dailyData: DailyData[] = [];
        const allBucketNames = new Set<string>();
        const bucketColorMap: Record<string, string> = {};

        for (const [date, data] of dailyMap) {
            dailyData.push({
                date,
                total: data.total,
                byBucket: data.byBucket,
            });
            for (const bName of Object.keys(data.byBucket)) {
                allBucketNames.add(bName);
            }
        }
        dailyData.sort((a, b) => a.date.localeCompare(b.date));

        // Build bucket color map from bucketBreakdowns
        for (const bd of bucketBreakdowns) {
            bucketColorMap[bd.bucketName] = bd.bucketColor;
        }

        // App usage (top 10 + full list)
        const appUsage: AppUsageData[] = [];
        const totalAppTime = Array.from(appTimeMap.values()).reduce((sum, t) => sum + t, 0);
        for (const [app, time] of appTimeMap) {
            appUsage.push({
                appName: app,
                totalTime: time,
                percentage: totalAppTime > 0 ? (time / totalAppTime) * 100 : 0,
            });
        }
        appUsage.sort((a, b) => b.totalTime - a.totalTime);

        // Hourly data
        const hourlyData: HourlyData[] = hourlyTime.map((time, hour) => ({ hour, totalTime: time }));

        // Focus sessions: find consecutive same-app activity sequences (gap < 5 min)
        allActivitySessions.sort((a, b) => a.timestamp - b.timestamp);
        const focusSessions: FocusSession[] = [];
        let focusTimeAbove15Min = 0;

        if (allActivitySessions.length > 0) {
            let sessionStart = allActivitySessions[0];
            let sessionDuration = sessionStart.duration;
            let sessionApp = sessionStart.appName;
            let sessionBucketId = sessionStart.bucketId;

            for (let i = 1; i < allActivitySessions.length; i++) {
                const curr = allActivitySessions[i];
                const prevEnd = allActivitySessions[i - 1].timestamp + allActivitySessions[i - 1].duration;
                const gap = curr.timestamp - prevEnd;

                if (curr.appName === sessionApp && gap < 5 * 60 * 1000) {
                    sessionDuration += curr.duration;
                } else {
                    // End current session
                    if (sessionDuration >= 15 * 60 * 1000) {
                        focusTimeAbove15Min += sessionDuration;
                    }
                    const bucket = sessionBucketId ? bucketMap.get(sessionBucketId) : null;
                    focusSessions.push({
                        appName: sessionApp,
                        duration: sessionDuration,
                        bucketName: bucket?.name || 'Unassigned',
                        bucketColor: bucket?.color || '#9CA3AF',
                    });
                    sessionApp = curr.appName;
                    sessionDuration = curr.duration;
                    sessionBucketId = curr.bucketId;
                    sessionStart = curr;
                }
            }
            // Push last session
            if (sessionDuration >= 15 * 60 * 1000) {
                focusTimeAbove15Min += sessionDuration;
            }
            const lastBucket = sessionBucketId ? bucketMap.get(sessionBucketId) : null;
            focusSessions.push({
                appName: sessionApp,
                duration: sessionDuration,
                bucketName: lastBucket?.name || 'Unassigned',
                bucketColor: lastBucket?.color || '#9CA3AF',
            });
        }

        focusSessions.sort((a, b) => b.duration - a.duration);
        const top5Sessions = focusSessions.slice(0, 5);

        // Context switches per hour
        const totalHours = totalActivityTime / (1000 * 60 * 60);
        const contextSwitchesPerHour = totalHours > 0 ? totalContextSwitches / totalHours : 0;

        // Focus ratio
        const focusRatio = totalActivityTime > 0 ? focusTimeAbove15Min / totalActivityTime : 0;

        // Focus score: average focus session length in minutes (capped at 60 for display)
        const avgFocusLength = focusSessions.length > 0
            ? focusSessions.reduce((sum, s) => sum + s.duration, 0) / focusSessions.length / (1000 * 60)
            : 0;

        return {
            totalTime,
            avgDaily,
            totalEntries: entries.length,
            uniqueDays,
            mostUsedApp,
            meetingTime: totalMeetingTime,
            focusScore: Math.round(avgFocusLength * 10) / 10,

            bucketBreakdowns,

            dailyData,
            bucketNames: Array.from(allBucketNames),
            bucketColors: bucketColorMap,

            appUsage,

            hourlyData,
            focusSessions: top5Sessions,
            contextSwitchesPerHour: Math.round(contextSwitchesPerHour * 10) / 10,
            focusRatio: Math.round(focusRatio * 1000) / 10,

            meetings,
            totalMeetingTime,
            totalMeetingCount: meetings.length,
            avgMeetingDuration: meetings.length > 0 ? totalMeetingTime / meetings.length : 0,
            totalTranscriptionWords,
        };
    }, [entries, buckets]);
}
