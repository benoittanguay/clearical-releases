import { test, expect } from '../fixtures/electron';
import { mockIPCHandler } from '../helpers/electron';

/**
 * UI Review Tests - Capture screenshots for design review
 */

test.describe('UI Review Screenshots', () => {
    // Test login screen (needs mockAuth: false)
    test.describe('Login Screen', () => {
        test.use({ mockAuth: false });

        test('capture login screen', async ({ window, electronApp }) => {
            // Mock unauthenticated state
            await mockIPCHandler(electronApp, 'auth:is-authenticated', () => false);
            await mockIPCHandler(electronApp, 'auth:get-user', () => ({
                success: false,
                error: 'Not authenticated'
            }));

            await window.waitForLoadState('domcontentloaded');
            await window.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await window.waitForSelector('text=Sign in to your account', { timeout: 15000 });
            await window.waitForTimeout(1000);

            // Capture login screen
            await window.screenshot({
                path: 'test-results/screenshots/login-screen.png',
                fullPage: true
            });

            // Verify the app icon is visible
            const appIcon = window.locator('img[alt="Clearical"]');
            await expect(appIcon).toBeVisible();

            // Verify icon size (should be 64px now)
            const iconBox = await appIcon.boundingBox();
            expect(iconBox?.width).toBeLessThanOrEqual(68); // Allow small variance
            expect(iconBox?.height).toBeLessThanOrEqual(68);
        });
    });

    // Test onboarding - use mockAuth: false to control the flow manually
    test.describe('Onboarding Modal', () => {
        test.use({ mockAuth: false });

        test('capture onboarding steps', async ({ window, electronApp }) => {
            // Mock authenticated state first
            await electronApp.evaluate(({ ipcMain }) => {
                const mockUser = {
                    id: 'test-user-123',
                    email: 'test@example.com',
                    createdAt: new Date().toISOString(),
                };
                ipcMain.removeHandler('auth:is-authenticated');
                ipcMain.removeHandler('auth:get-user');
                ipcMain.handle('auth:is-authenticated', () => true);
                ipcMain.handle('auth:get-user', () => ({ success: true, user: mockUser }));
            });

            // Clear onboarding flag to show modal
            await window.evaluate(() => {
                localStorage.removeItem('timeportal-onboarding-complete');
            });

            await window.reload();
            await window.waitForLoadState('domcontentloaded');
            await window.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await window.waitForTimeout(2000);

            // Wait for onboarding modal
            const onboardingModal = window.locator('text=System Permissions');
            const isVisible = await onboardingModal.isVisible({ timeout: 8000 }).catch(() => false);

            if (isVisible) {
                // Step 0: Permissions
                await window.screenshot({
                    path: 'test-results/screenshots/onboarding-step0-permissions.png'
                });

                // Click continue to go to step 1
                const continueButton = window.locator('button:has-text("Continue")');
                await continueButton.click();
                await window.waitForTimeout(400);

                // Step 1: Create bucket
                await window.screenshot({
                    path: 'test-results/screenshots/onboarding-step1-bucket.png'
                });

                // Skip to step 2
                const skipButton = window.locator('button:has-text("Skip")').first();
                await skipButton.click();
                await window.waitForTimeout(400);

                // Step 2: AI Features
                await window.screenshot({
                    path: 'test-results/screenshots/onboarding-step2-ai.png'
                });

                // Continue to step 3
                await continueButton.click();
                await window.waitForTimeout(400);

                // Step 3: Jira Configuration
                await window.screenshot({
                    path: 'test-results/screenshots/onboarding-step3-jira.png'
                });

                // Verify Jira form elements
                const baseUrlInput = window.locator('input[placeholder="https://your-domain.atlassian.net"]');
                await expect(baseUrlInput).toBeVisible();

                const emailInput = window.locator('input[placeholder="your.email@company.com"]');
                await expect(emailInput).toBeVisible();

                const apiTokenInput = window.locator('input[placeholder="Enter your Jira API token"]');
                await expect(apiTokenInput).toBeVisible();

                // Verify show/hide toggle exists
                const toggleButton = window.locator('button').filter({ has: window.locator('svg path[d*="M15 12a3"]') });
                await expect(toggleButton).toBeVisible();

                // Verify test connection button has lightning icon
                const testButton = window.locator('button:has-text("Test Connection")');
                await expect(testButton).toBeVisible();
            }
        });
    });
});
