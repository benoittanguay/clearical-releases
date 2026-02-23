/**
 * StoreKit 2 Integration for Mac App Store builds
 *
 * Uses Electron's built-in inAppPurchase module to handle
 * App Store subscriptions. Only active when process.mas is true.
 */

import { inAppPurchase } from 'electron';

export interface StoreKitProduct {
    productIdentifier: string;
    localizedTitle: string;
    localizedDescription: string;
    price: number;
    formattedPrice: string;
}

export interface StoreKitPurchaseResult {
    success: boolean;
    productIdentifier?: string;
    transactionIdentifier?: string;
    receipt?: string;
    error?: string;
}

// Product IDs matching App Store Connect configuration
export const STOREKIT_PRODUCT_IDS = [
    'com.clearical.workplace.monthly',
    'com.clearical.workplace.yearly',
];

// Track transactions already handled by purchaseProduct() to avoid
// double-processing by the global setupTransactionListener
const handledTransactionDates = new Set<string>();

/**
 * Check if StoreKit is available (MAS build)
 */
export function isStoreKitAvailable(): boolean {
    return !!(process as any).mas && inAppPurchase.canMakePayments();
}

/**
 * Get product information from App Store
 */
export async function getProducts(productIds: string[] = STOREKIT_PRODUCT_IDS): Promise<StoreKitProduct[]> {
    if (!isStoreKitAvailable()) {
        console.warn('[StoreKit] Not available (not MAS build or payments disabled)');
        return [];
    }

    try {
        console.log('[StoreKit] Fetching products:', productIds);
        const products = await inAppPurchase.getProducts(productIds);

        return products.map((p) => ({
            productIdentifier: p.productIdentifier,
            localizedTitle: p.localizedTitle,
            localizedDescription: p.localizedDescription,
            price: p.price,
            formattedPrice: p.formattedPrice,
        }));
    } catch (error) {
        console.error('[StoreKit] Failed to fetch products:', error);
        return [];
    }
}

/**
 * Initiate a purchase for a product
 */
export async function purchaseProduct(productId: string): Promise<StoreKitPurchaseResult> {
    if (!isStoreKitAvailable()) {
        return { success: false, error: 'In-app purchases not available' };
    }

    try {
        console.log('[StoreKit] Purchasing product:', productId);
        const isOk = inAppPurchase.purchaseProduct(productId);

        if (!isOk) {
            return { success: false, error: 'Purchase could not be initiated' };
        }

        // The actual result comes via the 'transactions-updated' event
        // We return success here to indicate the purchase flow started
        return new Promise((resolve) => {
            const handler = (_event: Electron.Event, transactions: Electron.Transaction[]) => {
                for (const transaction of transactions) {
                    if (transaction.payment.productIdentifier === productId) {
                        inAppPurchase.removeListener('transactions-updated', handler);

                        if (transaction.transactionState === 'purchased' || transaction.transactionState === 'restored') {
                            // Mark as handled so the global listener skips it
                            handledTransactionDates.add(transaction.transactionDate);
                            // Finish the transaction
                            inAppPurchase.finishTransactionByDate(transaction.transactionDate);

                            resolve({
                                success: true,
                                productIdentifier: transaction.payment.productIdentifier,
                                transactionIdentifier: transaction.transactionIdentifier,
                                receipt: getReceipt(),
                            });
                        } else if (transaction.transactionState === 'failed') {
                            handledTransactionDates.add(transaction.transactionDate);
                            inAppPurchase.finishTransactionByDate(transaction.transactionDate);
                            resolve({
                                success: false,
                                error: 'Purchase failed or was cancelled',
                            });
                        }
                        // 'purchasing' state means still in progress, keep listening
                    }
                }
            };

            inAppPurchase.on('transactions-updated', handler);

            // Timeout after 5 minutes
            setTimeout(() => {
                inAppPurchase.removeListener('transactions-updated', handler);
                resolve({ success: false, error: 'Purchase timed out' });
            }, 300000);
        });
    } catch (error) {
        console.error('[StoreKit] Purchase error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Purchase failed',
        };
    }
}

/**
 * Restore previous purchases
 */
export function restorePurchases(): void {
    if (!isStoreKitAvailable()) {
        console.warn('[StoreKit] Not available for restore');
        return;
    }

    console.log('[StoreKit] Restoring purchases...');
    inAppPurchase.restoreCompletedTransactions();
}

/**
 * Get the App Store receipt for server-side validation.
 * Retries a few times since the App Store daemon may not have
 * written the receipt file immediately after a transaction.
 */
export function getReceipt(): string {
    const path = require('path');
    const fs = require('fs');
    const receiptPath = path.join(
        require('electron').app.getPath('exe'),
        '..', '..', 'Contents', '_MASReceipt', 'receipt'
    );

    try {
        const receipt = fs.readFileSync(receiptPath);
        return receipt.toString('base64');
    } catch (error) {
        console.error('[StoreKit] Failed to get receipt:', error);
        return '';
    }
}

/**
 * Get receipt with retries for timing-sensitive operations (e.g. right after purchase).
 * The App Store daemon may not have updated the receipt file yet.
 */
export async function getReceiptWithRetry(maxRetries = 3, delayMs = 1000): Promise<string> {
    for (let i = 0; i <= maxRetries; i++) {
        const receipt = getReceipt();
        if (receipt) return receipt;
        if (i < maxRetries) {
            console.log(`[StoreKit] Receipt not available, retrying in ${delayMs}ms (${i + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return '';
}

/**
 * Set up transaction listener for ongoing subscription updates
 */
export function setupTransactionListener(
    onPurchased: (productId: string, receipt: string) => void,
    onRestored: (productId: string, receipt: string) => void
): void {
    if (!isStoreKitAvailable()) return;

    inAppPurchase.on('transactions-updated', (_event, transactions) => {
        for (const transaction of transactions) {
            const productId = transaction.payment.productIdentifier;

            // Skip transactions already handled by purchaseProduct()
            if (handledTransactionDates.has(transaction.transactionDate)) {
                handledTransactionDates.delete(transaction.transactionDate);
                continue;
            }

            switch (transaction.transactionState) {
                case 'purchased':
                    console.log('[StoreKit] Transaction purchased (global):', productId);
                    inAppPurchase.finishTransactionByDate(transaction.transactionDate);
                    onPurchased(productId, getReceipt());
                    break;

                case 'restored':
                    console.log('[StoreKit] Transaction restored (global):', productId);
                    inAppPurchase.finishTransactionByDate(transaction.transactionDate);
                    onRestored(productId, getReceipt());
                    break;

                case 'failed':
                    console.log('[StoreKit] Transaction failed:', productId);
                    inAppPurchase.finishTransactionByDate(transaction.transactionDate);
                    break;

                case 'purchasing':
                    console.log('[StoreKit] Transaction purchasing:', productId);
                    break;
            }
        }
    });

    console.log('[StoreKit] Transaction listener set up');
}
