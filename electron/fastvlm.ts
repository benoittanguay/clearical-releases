/**
 * FastVLM Server Management (On-Demand)
 *
 * Manages the lifecycle of the bundled FastVLM server for screenshot analysis.
 * The server is a standalone PyInstaller executable that includes:
 * - All Python dependencies (mlx-vlm, fastapi, uvicorn, etc.)
 * - The nanoLLaVA model (~500MB-1GB)
 *
 * Provides:
 * - On-demand server startup (only when needed)
 * - Automatic shutdown after 5 minutes of inactivity
 * - Health monitoring and auto-restart on crashes
 * - Screenshot analysis via HTTP API
 *
 * Server lifecycle:
 * - Starts automatically when analyzeScreenshot() is called
 * - Stays running while actively processing requests
 * - Shuts down after 5 minutes of no activity to save resources
 * - First analysis after idle shutdown will be slower (~30-60s for startup + model loading)
 */

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import net from 'net';

const FASTVLM_PORT = 5123;
const FASTVLM_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds
const SERVER_STARTUP_TIMEOUT = 180000; // 180 seconds (extended for cold-start with memory pressure)
const MAX_HEALTH_CHECK_RETRIES = 36; // 180 seconds total (5s intervals)
const IDLE_TIMEOUT = 300000; // 5 minutes of inactivity before shutdown (was 60s)
const MAX_REQUEST_RETRIES = 3; // Number of retries for analysis requests
const INITIAL_BACKOFF_MS = 1000; // Initial backoff delay for restart retries
const MAX_BACKOFF_MS = 30000; // Maximum backoff delay (30 seconds)
const PORT_WAIT_TIMEOUT = 10000; // Maximum time to wait for port to be freed (10 seconds)

interface AnalysisRequest {
    image_path: string;
    app_name?: string;
    window_title?: string;
}

interface AnalysisResponse {
    success: boolean;
    description: string | null;
    confidence?: number;
    error?: string;
    requestId?: string;
}

interface ClassifyRequest {
    description: string;
    options: Array<{ id: string; name: string }>;
    context?: string;
}

interface ClassifyResponse {
    success: boolean;
    selected_id?: string;
    selected_name?: string;
    confidence?: number;
    error?: string;
}

class FastVLMServer {
    private process: ChildProcessWithoutNullStreams | null = null;
    private isRunning: boolean = false;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private idleTimer: NodeJS.Timeout | null = null;
    private serverUrl: string = `http://${FASTVLM_HOST}:${FASTVLM_PORT}`;
    private isStarting: boolean = false;
    private restartBackoffMs: number = INITIAL_BACKOFF_MS;
    private consecutiveFailures: number = 0;

    constructor() {
        // Ensure cleanup on app quit
        app.on('before-quit', () => {
            this.stop();
        });
    }

    /**
     * Check if a port is available by attempting to bind to it
     * Returns true if port is free, false otherwise
     */
    private async checkPortAvailable(port: number, host: string): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();

            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`[FastVLM] Port ${port} is in use`);
                    resolve(false);
                } else {
                    // Other errors also indicate port is not available
                    console.log(`[FastVLM] Port check error:`, err.message);
                    resolve(false);
                }
            });

            server.once('listening', () => {
                // Port is available, clean up
                server.close(() => {
                    console.log(`[FastVLM] Port ${port} is available`);
                    resolve(true);
                });
            });

            server.listen(port, host);
        });
    }

    /**
     * Wait for port to be freed after server shutdown
     * Useful when port is in TIME_WAIT state
     */
    private async waitForPortFree(port: number, host: string, timeoutMs: number = PORT_WAIT_TIMEOUT): Promise<boolean> {
        const startTime = Date.now();
        console.log(`[FastVLM] Waiting for port ${port} to be freed (timeout: ${timeoutMs}ms)...`);

        while (Date.now() - startTime < timeoutMs) {
            const isAvailable = await this.checkPortAvailable(port, host);
            if (isAvailable) {
                console.log(`[FastVLM] Port ${port} is now free`);
                return true;
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.warn(`[FastVLM] Timeout waiting for port ${port} to be freed`);
        return false;
    }

    /**
     * Get the path to the FastVLM server executable
     */
    private getServerExecutablePath(): string | null {
        // In packaged app: Resources/fastvlm-server/fastvlm-server
        // In development: python/dist/fastvlm-server/fastvlm-server
        const possiblePaths = app.isPackaged
            ? [
                path.join(process.resourcesPath, 'fastvlm-server', 'fastvlm-server'),
              ]
            : [
                path.join(app.getAppPath(), 'python', 'dist', 'fastvlm-server', 'fastvlm-server'),
              ];

        for (const execPath of possiblePaths) {
            console.log('[FastVLM] Checking for executable at:', execPath);
            if (fs.existsSync(execPath)) {
                console.log('[FastVLM] Found executable at:', execPath);
                return execPath;
            }
        }

        console.error('[FastVLM] No executable found at any of:', possiblePaths);
        return null;
    }

    /**
     * Ensure the server is running, starting it if necessary.
     * This is the primary method to call before using the server.
     */
    async ensureRunning(): Promise<boolean> {
        // If already running, reset idle timer and return
        if (this.isRunning) {
            console.log('[FastVLM] Server already running, resetting idle timer');
            this.resetIdleTimer();
            return true;
        }

        // If currently starting, wait for it to finish
        if (this.isStarting) {
            console.log('[FastVLM] Server is already starting, waiting...');
            // Poll until startup completes or fails
            for (let i = 0; i < 60; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (this.isRunning) {
                    this.resetIdleTimer();
                    return true;
                }
                if (!this.isStarting) {
                    break;
                }
            }
            return this.isRunning;
        }

        // Start the server
        return await this.start();
    }

    /**
     * Start the FastVLM server (bundled executable)
     */
    async start(): Promise<boolean> {
        if (this.isRunning) {
            console.log('[FastVLM] Server already running');
            this.resetIdleTimer();
            return true;
        }

        if (this.isStarting) {
            console.log('[FastVLM] Server startup already in progress');
            return false;
        }

        this.isStarting = true;
        console.log('[FastVLM] Starting bundled FastVLM server (on-demand)...');

        try {
            // Get path to bundled executable
            const executablePath = this.getServerExecutablePath();
            if (!executablePath) {
                console.error('[FastVLM] Bundled executable not found');
                console.error('[FastVLM] FastVLM will not be available - falling back to Swift');
                this.isStarting = false;
                return false;
            }

            console.log('[FastVLM] Executable path:', executablePath);

            // Check if port is available before spawning
            const portAvailable = await this.checkPortAvailable(FASTVLM_PORT, FASTVLM_HOST);
            if (!portAvailable) {
                console.log('[FastVLM] Port is in use, waiting for it to be freed...');
                const portFreed = await this.waitForPortFree(FASTVLM_PORT, FASTVLM_HOST);
                if (!portFreed) {
                    console.error('[FastVLM] Port still not available after waiting, aborting startup');
                    this.isStarting = false;
                    return false;
                }
            }

            // Spawn the bundled executable
            this.process = spawn(executablePath, ['--port', FASTVLM_PORT.toString()], {
                env: {
                    ...process.env,
                },
                // Set working directory to the executable's directory
                // so it can find the bundled model
                cwd: path.dirname(executablePath)
            });

            // Log stdout
            if (this.process.stdout) {
                this.process.stdout.on('data', (data) => {
                    console.log(`[FastVLM] ${data.toString().trim()}`);
                });
            }

            // Log stderr
            if (this.process.stderr) {
                this.process.stderr.on('data', (data) => {
                    console.error(`[FastVLM] ${data.toString().trim()}`);
                });
            }

            // Handle process exit
            this.process.on('exit', (code, signal) => {
                console.log(`[FastVLM] Server process exited with code ${code}, signal ${signal}`);
                this.isRunning = false;
                this.process = null;

                // Stop health checks
                if (this.healthCheckInterval) {
                    clearInterval(this.healthCheckInterval);
                    this.healthCheckInterval = null;
                }
            });

            // Handle process errors
            this.process.on('error', (error) => {
                console.error('[FastVLM] Server process error:', error);
                this.isRunning = false;
                this.process = null;
            });

            // Wait for server to be ready (model loading can take 30-60s on first run)
            console.log('[FastVLM] Waiting for server to be ready (model loading may take up to 60s)...');
            const isReady = await this.waitForServerReady();
            if (isReady) {
                this.isRunning = true;
                this.isStarting = false;
                console.log('[FastVLM] Server started successfully');

                // Start health monitoring
                this.startHealthMonitoring();

                // Start idle timer for auto-shutdown
                this.resetIdleTimer();

                return true;
            } else {
                console.error('[FastVLM] Server failed to start within timeout');
                this.isStarting = false;
                this.stop();
                return false;
            }

        } catch (error) {
            console.error('[FastVLM] Failed to start server:', error);
            this.isStarting = false;
            this.stop();
            return false;
        }
    }

    /**
     * Stop the FastVLM server
     */
    async stop(): Promise<void> {
        console.log('[FastVLM] Stopping server...');

        // Clear idle timer
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }

        // Stop health monitoring
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Kill the process
        if (this.process) {
            const processToKill = this.process;
            this.process = null;

            processToKill.kill('SIGTERM');

            // Wait for graceful shutdown, then force kill if needed
            await new Promise<void>((resolve) => {
                const forceKillTimer = setTimeout(() => {
                    console.log('[FastVLM] Force killing server process');
                    try {
                        processToKill.kill('SIGKILL');
                    } catch (error) {
                        // Process may already be dead
                        console.log('[FastVLM] Process already terminated');
                    }
                    resolve();
                }, 5000);

                // Listen for process exit
                processToKill.once('exit', () => {
                    clearTimeout(forceKillTimer);
                    resolve();
                });
            });
        }

        this.isRunning = false;
        this.isStarting = false;

        // Wait for port to be freed
        console.log('[FastVLM] Waiting for port to be freed after shutdown...');
        await this.waitForPortFree(FASTVLM_PORT, FASTVLM_HOST);

        console.log('[FastVLM] Server stopped');
    }

    /**
     * Restart the FastVLM server with exponential backoff
     */
    async restart(): Promise<boolean> {
        console.log(`[FastVLM] Restarting server with backoff delay: ${this.restartBackoffMs}ms (consecutive failures: ${this.consecutiveFailures})...`);

        await this.stop();

        // Apply exponential backoff delay
        console.log(`[FastVLM] Waiting ${this.restartBackoffMs}ms before restart...`);
        await new Promise(resolve => setTimeout(resolve, this.restartBackoffMs));

        // Increment consecutive failures for next potential restart
        this.consecutiveFailures++;

        // Calculate next backoff (exponential: 1s, 2s, 4s, 8s, 16s, 30s max)
        this.restartBackoffMs = Math.min(
            this.restartBackoffMs * 2,
            MAX_BACKOFF_MS
        );

        return await this.start();
    }

    /**
     * Check if the server is running and healthy
     */
    async isHealthy(): Promise<boolean> {
        if (!this.isRunning) {
            return false;
        }

        try {
            const response = await fetch(`${this.serverUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000) // 2 second timeout
            });

            if (response.ok) {
                const data = await response.json() as { status: string };
                const isHealthy = data.status === 'healthy';

                if (isHealthy) {
                    // Reset backoff on successful health check
                    if (this.consecutiveFailures > 0) {
                        console.log('[FastVLM] Health check successful, resetting backoff');
                        this.consecutiveFailures = 0;
                        this.restartBackoffMs = INITIAL_BACKOFF_MS;
                    }
                }

                return isHealthy;
            }

            return false;
        } catch (error) {
            console.error('[FastVLM] Health check failed:', error);
            return false;
        }
    }

    /**
     * Retry a request with exponential backoff
     * Only retries on transient errors (network, timeout, 5xx), not permanent failures (4xx)
     */
    private async retryRequest<T>(
        requestFn: () => Promise<T>,
        operationName: string,
        maxRetries: number = MAX_REQUEST_RETRIES
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error as Error;

                // Check if error is retryable
                const isRetryable = this.isRetryableError(error);

                if (!isRetryable) {
                    console.log(`[FastVLM] ${operationName} failed with non-retryable error, not retrying`);
                    throw error;
                }

                if (attempt < maxRetries - 1) {
                    // Calculate delay with exponential backoff: 1s, 2s, 4s
                    const delayMs = Math.pow(2, attempt) * 1000;
                    console.log(`[FastVLM] ${operationName} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                } else {
                    console.error(`[FastVLM] ${operationName} failed after ${maxRetries} attempts`);
                }
            }
        }

        throw lastError;
    }

    /**
     * Check if an error is retryable (transient) or permanent
     */
    private isRetryableError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }

        const errorMessage = error.message.toLowerCase();

        // Retry on network errors
        if (error.name === 'TimeoutError' ||
            error.name === 'AbortError' ||
            errorMessage.includes('fetch failed') ||
            errorMessage.includes('econnrefused') ||
            errorMessage.includes('enotfound') ||
            errorMessage.includes('epipe') ||
            errorMessage.includes('broken pipe') ||
            errorMessage.includes('socket hang up') ||
            errorMessage.includes('network')) {
            return true;
        }

        // Retry on 5xx server errors
        if (errorMessage.includes('server returned 5')) {
            return true;
        }

        // Retry on 503 Service Unavailable
        if (errorMessage.includes('503')) {
            return true;
        }

        // Don't retry on 4xx client errors (bad request, not found, etc.)
        if (errorMessage.includes('server returned 4')) {
            return false;
        }

        // Default to not retrying unknown errors
        return false;
    }

    /**
     * Analyze a screenshot using the FastVLM server
     */
    async analyzeScreenshot(
        imagePath: string,
        appName?: string,
        windowTitle?: string,
        requestId?: string
    ): Promise<AnalysisResponse> {
        // Ensure server is running before attempting analysis
        console.log('[FastVLM] Ensuring server is running for analysis...');
        const serverReady = await this.ensureRunning();

        if (!serverReady) {
            return {
                success: false,
                description: null,
                error: 'Failed to start FastVLM server'
            };
        }

        try {
            // Wrap the analysis request in retry logic
            return await this.retryRequest(async () => {
                const requestBody: AnalysisRequest = {
                    image_path: imagePath,
                    app_name: appName,
                    window_title: windowTitle
                };

                console.log('[FastVLM] Sending analysis request:', imagePath, 'app:', appName, 'window:', windowTitle);

                const response = await fetch(`${this.serverUrl}/analyze`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(30000) // 30 second timeout for analysis
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server returned ${response.status}: ${errorText}`);
                }

                const result = await response.json() as AnalysisResponse;
                console.log('[FastVLM] Analysis complete:', result.description?.substring(0, 100));

                // Reset idle timer after successful analysis
                this.resetIdleTimer();

                return result;
            }, 'Analysis');

        } catch (error) {
            console.error('[FastVLM] Analysis request failed:', error);

            // Provide more context for timeout errors
            let errorMessage = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.name === 'TimeoutError') {
                errorMessage = 'Analysis timed out after 30 seconds. The model may be taking longer than expected.';
            } else if (error instanceof Error && (error.message.includes('EPIPE') || error.message.includes('Broken pipe'))) {
                errorMessage = 'Connection lost during analysis. The server may still be processing the request.';
            }

            return {
                success: false,
                description: null,
                error: errorMessage
            };
        }
    }

    /**
     * Classify an activity description to one of the provided options
     * Uses the Qwen3-0.6B reasoning model for semantic understanding
     */
    async classifyActivity(
        description: string,
        options: Array<{ id: string; name: string }>,
        context?: string
    ): Promise<ClassifyResponse> {
        // Ensure server is running before attempting classification
        console.log('[FastVLM] Ensuring server is running for classification...');
        const serverReady = await this.ensureRunning();

        if (!serverReady) {
            return {
                success: false,
                error: 'Failed to start FastVLM server'
            };
        }

        try {
            // Wrap the classification request in retry logic
            return await this.retryRequest(async () => {
                const requestBody: ClassifyRequest = {
                    description,
                    options,
                    context
                };

                console.log('[FastVLM] Sending classify request with', options.length, 'options');

                const response = await fetch(`${this.serverUrl}/classify`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(15000) // 15 second timeout for classification
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server returned ${response.status}: ${errorText}`);
                }

                const result = await response.json() as ClassifyResponse;
                console.log('[FastVLM] Classification complete:', result.selected_name, 'confidence:', result.confidence);

                // Reset idle timer after successful classification
                this.resetIdleTimer();

                return result;
            }, 'Classification');

        } catch (error) {
            console.error('[FastVLM] Classification request failed:', error);

            // Provide more context for timeout errors
            let errorMessage = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.name === 'TimeoutError') {
                errorMessage = 'Classification timed out after 15 seconds. The model may be taking longer than expected.';
            } else if (error instanceof Error && (error.message.includes('EPIPE') || error.message.includes('Broken pipe'))) {
                errorMessage = 'Connection lost during classification. The server may still be processing the request.';
            }

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Summarize multiple activity descriptions into a cohesive narrative
     * Uses the Qwen3-0.6B reasoning model to create story-like summaries
     */
    async summarizeActivities(
        descriptions: string[],
        appNames?: string[]
    ): Promise<{ success: boolean; summary?: string; error?: string }> {
        // Ensure server is running before attempting summarization
        console.log('[FastVLM] Ensuring server is running for summarization...');
        const serverReady = await this.ensureRunning();

        if (!serverReady) {
            return {
                success: false,
                error: 'Failed to start FastVLM server'
            };
        }

        try {
            // Wrap the summarization request in retry logic
            return await this.retryRequest(async () => {
                const requestBody = {
                    descriptions,
                    app_names: appNames
                };

                console.log('[FastVLM] Sending summarization request with', descriptions.length, 'descriptions');

                const response = await fetch(`${this.serverUrl}/summarize`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(60000) // 60 second timeout for summarization (generates longer text than classification)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server returned ${response.status}: ${errorText}`);
                }

                const result = await response.json() as { success: boolean; summary: string; error?: string };
                console.log('[FastVLM] Summarization complete:', result.summary?.substring(0, 100));

                // Reset idle timer after successful summarization
                this.resetIdleTimer();

                return result;
            }, 'Summarization');

        } catch (error) {
            console.error('[FastVLM] Summarization request failed:', error);

            // Provide more context for timeout errors
            let errorMessage = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.name === 'TimeoutError') {
                errorMessage = 'Summarization timed out after 60 seconds. The model may be taking longer than expected to generate the summary.';
            } else if (error instanceof Error && (error.message.includes('EPIPE') || error.message.includes('Broken pipe'))) {
                errorMessage = 'Connection lost during summarization. The server may still be processing the request.';
            }

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Wait for the server to be ready by polling the health endpoint
     */
    private async waitForServerReady(): Promise<boolean> {
        console.log('[FastVLM] Waiting for server to be ready...');

        for (let i = 0; i < MAX_HEALTH_CHECK_RETRIES; i++) {
            try {
                const response = await fetch(`${this.serverUrl}/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000)
                });

                if (response.ok) {
                    const data = await response.json() as { status: string };
                    if (data.status === 'healthy') {
                        console.log('[FastVLM] Server is ready');
                        return true;
                    }
                }
            } catch (error) {
                // Server not ready yet, continue polling
                console.log(`[FastVLM] Health check attempt ${i + 1}/${MAX_HEALTH_CHECK_RETRIES} failed, retrying...`);
            }

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        return false;
    }

    /**
     * Start periodic health monitoring
     * Only restarts the server if it became unhealthy (not if intentionally stopped)
     */
    private startHealthMonitoring(): void {
        if (this.healthCheckInterval) {
            return;
        }

        console.log('[FastVLM] Starting health monitoring');

        this.healthCheckInterval = setInterval(async () => {
            const healthy = await this.isHealthy();

            // Only restart if marked as running but unhealthy (crash scenario)
            // Don't restart if intentionally stopped (isRunning = false)
            if (!healthy && this.isRunning && this.process !== null) {
                console.warn('[FastVLM] Server became unhealthy, attempting restart...');
                await this.restart();
            }
        }, HEALTH_CHECK_INTERVAL);
    }

    /**
     * Reset the idle timer - call this on each request to keep server alive
     */
    private resetIdleTimer(): void {
        // Clear existing timer
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }

        // Set new timer to shut down after idle period
        this.idleTimer = setTimeout(async () => {
            if (this.isRunning) {
                console.log(`[FastVLM] Server idle for ${IDLE_TIMEOUT/1000}s, shutting down to save resources...`);
                await this.stop();
            }
        }, IDLE_TIMEOUT);

        console.log(`[FastVLM] Idle timer reset - server will shut down after ${IDLE_TIMEOUT/1000}s of inactivity`);
    }

    /**
     * Get server status
     */
    getStatus(): { isRunning: boolean; url: string } {
        return {
            isRunning: this.isRunning,
            url: this.serverUrl
        };
    }
}

// Export singleton instance
export const fastVLMServer = new FastVLMServer();
