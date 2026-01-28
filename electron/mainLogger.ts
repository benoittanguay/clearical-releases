/**
 * Main Process Logger
 *
 * Captures main process logs to a file for debugging in production.
 * Logs are written to: ~/Library/Application Support/Clearical/main-process.log
 *
 * The log file is rotated on each app start (previous log saved as main-process.previous.log)
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

class MainProcessLogger {
    private logPath: string;
    private previousLogPath: string;
    private writeStream: fs.WriteStream | null = null;
    private originalConsoleLog: typeof console.log;
    private originalConsoleError: typeof console.error;
    private originalConsoleWarn: typeof console.warn;
    private isEnabled: boolean = true;

    constructor() {
        // Store original console methods
        this.originalConsoleLog = console.log.bind(console);
        this.originalConsoleError = console.error.bind(console);
        this.originalConsoleWarn = console.warn.bind(console);

        // Set up log paths - use userData which is available even before app is ready
        const userDataPath = app.getPath('userData');
        this.logPath = path.join(userDataPath, 'main-process.log');
        this.previousLogPath = path.join(userDataPath, 'main-process.previous.log');
    }

    /**
     * Initialize the logger - call this early in main.ts
     */
    public initialize(): void {
        try {
            // Ensure directory exists
            const logDir = path.dirname(this.logPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            // Rotate logs - save previous log
            if (fs.existsSync(this.logPath)) {
                try {
                    // Copy current to previous (overwrite)
                    fs.copyFileSync(this.logPath, this.previousLogPath);
                } catch (err) {
                    // Ignore rotation errors
                }
            }

            // Create new log file
            this.writeStream = fs.createWriteStream(this.logPath, { flags: 'w' });

            // Write header
            const header = `
================================================================================
Clearical Main Process Log
Started: ${new Date().toISOString()}
App Version: ${app.getVersion()}
Electron: ${process.versions.electron}
Node: ${process.versions.node}
Platform: ${process.platform} ${process.arch}
================================================================================

`;
            this.writeStream.write(header);

            // Override console methods
            this.hookConsole();

            this.originalConsoleLog('[MainLogger] Initialized - logging to:', this.logPath);
        } catch (err) {
            this.originalConsoleError('[MainLogger] Failed to initialize:', err);
            this.isEnabled = false;
        }
    }

    private hookConsole(): void {
        console.log = (...args: any[]) => {
            this.originalConsoleLog(...args);
            this.writeToFile('LOG', args);
        };

        console.error = (...args: any[]) => {
            this.originalConsoleError(...args);
            this.writeToFile('ERROR', args);
        };

        console.warn = (...args: any[]) => {
            this.originalConsoleWarn(...args);
            this.writeToFile('WARN', args);
        };
    }

    private writeToFile(level: string, args: any[]): void {
        if (!this.isEnabled || !this.writeStream) return;

        try {
            const timestamp = new Date().toISOString();
            const message = args.map(arg => {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');

            this.writeStream.write(`[${timestamp}] [${level}] ${message}\n`);
        } catch (err) {
            // Silently ignore write errors to prevent infinite loops
        }
    }

    /**
     * Get the path to the current log file
     */
    public getLogPath(): string {
        return this.logPath;
    }

    /**
     * Get the path to the previous log file
     */
    public getPreviousLogPath(): string {
        return this.previousLogPath;
    }

    /**
     * Flush and close the log file
     */
    public close(): void {
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }
}

// Export singleton instance
export const mainLogger = new MainProcessLogger();
