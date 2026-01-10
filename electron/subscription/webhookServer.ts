/**
 * Stripe Webhook Server
 *
 * Local HTTP server to receive Stripe webhook events.
 * Handles subscription lifecycle events for real-time updates.
 *
 * IMPORTANT: For production, you'll need to expose this server via:
 * - ngrok (development/testing)
 * - A cloud endpoint (production)
 * - Cloudflare Tunnel (recommended for Electron apps)
 */

import http from 'http';
import crypto from 'crypto';
import {
    SubscriptionConfig,
    SubscriptionStatus,
    SubscriptionPlan,
    StripeWebhookEvent,
    SubscriptionError,
    SubscriptionErrorCode,
} from './types.js';
import { SubscriptionStorage } from './subscriptionStorage.js';
import { StripeClient } from './stripeClient.js';

interface StripeWebhookPayload {
    id: string;
    type: string;
    data: {
        object: any;
    };
}

/**
 * Webhook server for receiving Stripe events
 */
export class WebhookServer {
    private server: http.Server | null = null;
    private config: SubscriptionConfig;
    private stripeClient: StripeClient;
    private port: number;

    constructor(config: SubscriptionConfig, stripeClient: StripeClient) {
        this.config = config;
        this.stripeClient = stripeClient;
        this.port = config.webhookServerPort || 3001;
    }

    /**
     * Start webhook server
     */
    async start(): Promise<void> {
        if (this.server) {
            console.log('[WebhookServer] Server already running');
            return;
        }

        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));

            this.server.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    console.warn(`[WebhookServer] Port ${this.port} is in use, trying ${this.port + 1}`);
                    this.port += 1;
                    this.server?.listen(this.port);
                } else {
                    console.error('[WebhookServer] Server error:', error);
                    reject(error);
                }
            });

            this.server.listen(this.port, () => {
                console.log(`[WebhookServer] Listening on http://localhost:${this.port}/webhook`);
                console.log('[WebhookServer] To receive webhooks, expose this endpoint using:');
                console.log('[WebhookServer]   - ngrok: ngrok http ' + this.port);
                console.log('[WebhookServer]   - Cloudflare Tunnel (recommended)');
                resolve();
            });
        });
    }

    /**
     * Stop webhook server
     */
    async stop(): Promise<void> {
        if (!this.server) {
            return;
        }

        return new Promise((resolve, reject) => {
            this.server?.close((error) => {
                if (error) {
                    console.error('[WebhookServer] Error stopping server:', error);
                    reject(error);
                } else {
                    console.log('[WebhookServer] Server stopped');
                    this.server = null;
                    resolve();
                }
            });
        });
    }

    /**
     * Handle incoming HTTP request
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Only accept POST requests to /webhook
        if (req.method !== 'POST' || req.url !== '/webhook') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        try {
            // Read request body
            const body = await this.readRequestBody(req);

            // Verify webhook signature
            const signature = req.headers['stripe-signature'] as string;
            if (!signature) {
                throw new Error('Missing Stripe signature');
            }

            const event = this.verifyWebhookSignature(body, signature);

            // Process webhook event
            await this.processWebhookEvent(event);

            // Respond with success
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
        } catch (error) {
            console.error('[WebhookServer] Webhook processing failed:', error);

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    error: error instanceof Error ? error.message : 'Unknown error',
                })
            );
        }
    }

    /**
     * Read request body as string
     */
    private readRequestBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';

            req.on('data', (chunk) => {
                body += chunk.toString();
            });

            req.on('end', () => {
                resolve(body);
            });

            req.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Verify Stripe webhook signature
     */
    private verifyWebhookSignature(payload: string, signature: string): StripeWebhookPayload {
        if (!this.config.stripeWebhookSecret) {
            throw new Error('Webhook secret not configured');
        }

        // Parse signature header
        const signatureParts = signature.split(',').reduce((acc, part) => {
            const [key, value] = part.split('=');
            acc[key] = value;
            return acc;
        }, {} as Record<string, string>);

        const timestamp = signatureParts.t;
        const expectedSignature = signatureParts.v1;

        if (!timestamp || !expectedSignature) {
            throw new Error('Invalid signature format');
        }

        // Construct signed payload
        const signedPayload = `${timestamp}.${payload}`;

        // Compute HMAC
        const computedSignature = crypto
            .createHmac('sha256', this.config.stripeWebhookSecret)
            .update(signedPayload)
            .digest('hex');

        // Compare signatures (timing-safe)
        const isValid = crypto.timingSafeEqual(
            Buffer.from(expectedSignature),
            Buffer.from(computedSignature)
        );

        if (!isValid) {
            throw new Error('Invalid webhook signature');
        }

        // Check timestamp (prevent replay attacks)
        const timestampAge = Date.now() - parseInt(timestamp) * 1000;
        const maxAge = 5 * 60 * 1000; // 5 minutes

        if (timestampAge > maxAge) {
            throw new Error('Webhook timestamp too old');
        }

        // Parse and return event
        return JSON.parse(payload) as StripeWebhookPayload;
    }

    /**
     * Process webhook event
     */
    private async processWebhookEvent(event: StripeWebhookPayload): Promise<void> {
        console.log('[WebhookServer] Processing event:', event.type, event.id);

        switch (event.type) {
            case StripeWebhookEvent.CUSTOMER_SUBSCRIPTION_CREATED:
            case StripeWebhookEvent.CUSTOMER_SUBSCRIPTION_UPDATED:
                await this.handleSubscriptionUpdated(event.data.object);
                break;

            case StripeWebhookEvent.CUSTOMER_SUBSCRIPTION_DELETED:
                await this.handleSubscriptionDeleted(event.data.object);
                break;

            case StripeWebhookEvent.CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END:
                await this.handleTrialWillEnd(event.data.object);
                break;

            case StripeWebhookEvent.INVOICE_PAYMENT_SUCCEEDED:
                await this.handlePaymentSucceeded(event.data.object);
                break;

            case StripeWebhookEvent.INVOICE_PAYMENT_FAILED:
                await this.handlePaymentFailed(event.data.object);
                break;

            default:
                console.log('[WebhookServer] Unhandled event type:', event.type);
        }
    }

    /**
     * Handle subscription created/updated
     */
    private async handleSubscriptionUpdated(stripeSubscription: any): Promise<void> {
        console.log('[WebhookServer] Subscription updated:', stripeSubscription.id);

        try {
            const customerId = stripeSubscription.customer;

            // Get current subscription from storage
            const currentSubscription = await SubscriptionStorage.getSubscription();

            if (!currentSubscription || currentSubscription.stripeCustomerId !== customerId) {
                console.log('[WebhookServer] Subscription not found in storage, fetching customer');
                // We don't have this subscription yet, fetch customer info
                const customer = await this.stripeClient.getCustomer(customerId);

                // Create new subscription from Stripe data
                const deviceFingerprint = currentSubscription?.devices[0] || {
                    deviceId: 'webhook-created',
                    deviceName: 'Unknown Device',
                    platform: 'unknown',
                    osVersion: 'unknown',
                    lastSeenAt: Date.now(),
                    registeredAt: Date.now(),
                };

                const newSubscription = this.stripeClient.transformStripeSubscription(
                    stripeSubscription,
                    customer,
                    deviceFingerprint.deviceId,
                    currentSubscription?.devices || [deviceFingerprint]
                );

                await SubscriptionStorage.saveSubscription(newSubscription);
                console.log('[WebhookServer] New subscription saved');
            } else {
                // Update existing subscription
                const customer = await this.stripeClient.getCustomer(customerId);
                const updatedSubscription = this.stripeClient.transformStripeSubscription(
                    stripeSubscription,
                    customer,
                    currentSubscription.deviceId,
                    currentSubscription.devices
                );

                // Preserve local metadata
                updatedSubscription.createdAt = currentSubscription.createdAt;
                updatedSubscription.lastWebhookReceived = Date.now();

                await SubscriptionStorage.saveSubscription(updatedSubscription);
                console.log('[WebhookServer] Subscription updated');
            }
        } catch (error) {
            console.error('[WebhookServer] Failed to handle subscription update:', error);
            throw error;
        }
    }

    /**
     * Handle subscription deleted
     */
    private async handleSubscriptionDeleted(stripeSubscription: any): Promise<void> {
        console.log('[WebhookServer] Subscription deleted:', stripeSubscription.id);

        try {
            const currentSubscription = await SubscriptionStorage.getSubscription();

            if (
                currentSubscription &&
                currentSubscription.stripeSubscriptionId === stripeSubscription.id
            ) {
                // Update to free plan
                currentSubscription.status = SubscriptionStatus.CANCELED;
                currentSubscription.plan = SubscriptionPlan.FREE;
                currentSubscription.stripeSubscriptionId = undefined;
                currentSubscription.stripePriceId = undefined;
                currentSubscription.updatedAt = Date.now();
                currentSubscription.lastWebhookReceived = Date.now();

                await SubscriptionStorage.saveSubscription(currentSubscription);
                console.log('[WebhookServer] Subscription canceled, reverted to free plan');
            }
        } catch (error) {
            console.error('[WebhookServer] Failed to handle subscription deletion:', error);
            throw error;
        }
    }

    /**
     * Handle trial ending soon
     */
    private async handleTrialWillEnd(stripeSubscription: any): Promise<void> {
        console.log('[WebhookServer] Trial will end soon:', stripeSubscription.id);

        // TODO: Send notification to user
        // This could trigger an in-app notification or email
    }

    /**
     * Handle payment succeeded
     */
    private async handlePaymentSucceeded(invoice: any): Promise<void> {
        console.log('[WebhookServer] Payment succeeded:', invoice.id);

        if (invoice.subscription) {
            // Payment was for a subscription, update subscription status
            const stripeSubscription = await this.stripeClient.getSubscription(invoice.subscription);
            await this.handleSubscriptionUpdated(stripeSubscription);
        }
    }

    /**
     * Handle payment failed
     */
    private async handlePaymentFailed(invoice: any): Promise<void> {
        console.log('[WebhookServer] Payment failed:', invoice.id);

        if (invoice.subscription) {
            // Payment failed for a subscription, update status
            const stripeSubscription = await this.stripeClient.getSubscription(invoice.subscription);
            await this.handleSubscriptionUpdated(stripeSubscription);
        }

        // TODO: Send notification to user about payment failure
    }

    /**
     * Get webhook endpoint URL
     */
    getEndpointUrl(): string {
        return `http://localhost:${this.port}/webhook`;
    }

    /**
     * Get port number
     */
    getPort(): number {
        return this.port;
    }
}
