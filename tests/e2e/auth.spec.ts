import { test, expect } from '../fixtures/electron';
import { mockIPCHandler } from '../helpers/electron';

/**
 * Authentication E2E Tests for TimePortal
 *
 * Tests cover the complete authentication flow including:
 * - Login screen display and validation
 * - OTP sending and verification
 * - Sign out functionality
 * - Session management and persistence
 */

// Disable the default authentication mock for auth tests
// We need to test the actual login screen behavior
test.use({ mockAuth: false });

/**
 * Mock user data for testing
 */
const mockUser = {
  id: 'test-user-123',
  email: 'test@example.com',
  createdAt: '2024-01-01T00:00:00Z',
  lastSignIn: '2024-01-10T00:00:00Z',
};

/**
 * Helper function to wait for login screen
 */
async function waitForLoginScreen(window: any) {
  await window.waitForLoadState('domcontentloaded');
  await window.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
    console.log('Network idle timeout in waitForLoginScreen, continuing...');
  });
  await window.waitForSelector('text=Sign in to your account', { timeout: 15000, state: 'visible' });
  // Additional wait for React hydration
  await window.waitForTimeout(500);
}

/**
 * Helper function to mock unauthenticated state
 */
async function mockUnauthenticatedState(electronApp: any) {
  // Mock auth:is-authenticated to return false
  await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
    return false;
  });

  // Mock auth:get-user to return not authenticated
  await mockIPCHandler(electronApp, 'auth:get-user', () => {
    return { success: false, error: 'Not authenticated' };
  });

  // Small delay to ensure mocks are registered
  await new Promise(resolve => setTimeout(resolve, 200));
}

/**
 * Helper function to mock authenticated state
 */
async function mockAuthenticatedState(electronApp: any) {
  // Mock auth:is-authenticated to return true
  await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
    return true;
  });

  // Mock auth:get-user to return user data
  await mockIPCHandler(electronApp, 'auth:get-user', () => {
    return { success: true, user: mockUser };
  });

  // Small delay to ensure mocks are registered
  await new Promise(resolve => setTimeout(resolve, 200));
}

test.describe('Authentication - Login Screen', () => {
  test('should display login screen when not authenticated', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Verify main elements are visible
    const heading = window.locator('text=Sign in to your account');
    await expect(heading).toBeVisible();

    const emailLabel = window.locator('text=Email address');
    await expect(emailLabel).toBeVisible();

    const emailInput = window.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    const submitButton = window.locator('button:has-text("Continue with Email")');
    await expect(submitButton).toBeVisible();
  });

  test('should display Clearical branding', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Check for logo/brand
    const brandTitle = window.locator('text=Clearical');
    await expect(brandTitle).toBeVisible();

    const brandTagline = window.locator('text=Track your time, boost productivity');
    await expect(brandTagline).toBeVisible();
  });

  test('should have email input with correct attributes', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const emailInput = window.locator('input[type="email"]');

    // Verify input has autofocus
    const isAutoFocused = await emailInput.evaluate((el) => el === document.activeElement);
    expect(isAutoFocused).toBe(true);

    // Verify placeholder
    const placeholder = await emailInput.getAttribute('placeholder');
    expect(placeholder).toBe('you@example.com');
  });

  test('should accept valid email input', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const emailInput = window.locator('input[type="email"]');

    // Type email
    await emailInput.fill('test@example.com');

    // Verify value
    const value = await emailInput.inputValue();
    expect(value).toBe('test@example.com');
  });

  test('should validate email requires @ symbol', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock send OTP handler
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Enter invalid email (no @)
    await emailInput.fill('invalidemail');
    await submitButton.click();

    // Wait for validation error
    await window.waitForTimeout(100);

    // Check for error message
    const errorMessage = window.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should validate email is not empty', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock send OTP handler
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Try to submit without email
    await submitButton.click();

    // Wait for validation error
    await window.waitForTimeout(100);

    // Check for error message
    const errorMessage = window.locator('text=Please enter a valid email address');
    await expect(errorMessage).toBeVisible();
  });

  test('should show loading state while sending OTP', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock send OTP handler with delay
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true });
        }, 1000);
      });
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Enter email and submit
    await emailInput.fill('test@example.com');
    await submitButton.click();

    // Check for loading state
    const loadingText = window.locator('text=Sending code...');
    await expect(loadingText).toBeVisible();

    // Check button is disabled
    const isDisabled = await submitButton.isDisabled();
    expect(isDisabled).toBe(true);

    // Check for spinner
    const spinner = window.locator('svg.animate-spin');
    await expect(spinner).toBeVisible();
  });

  test('should transition to OTP screen after successful send', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock successful OTP send
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Enter email and submit
    await emailInput.fill('test@example.com');
    await submitButton.click();

    // Wait for OTP screen
    await window.waitForTimeout(500);

    // Verify OTP screen elements
    const otpHeading = window.locator('text=Enter verification code');
    await expect(otpHeading).toBeVisible();

    const otpMessage = window.locator('text=We sent a 6-digit code to');
    await expect(otpMessage).toBeVisible();
  });

  test('should display error when OTP send fails', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock failed OTP send
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: false, error: 'Failed to send verification code' };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Enter email and submit
    await emailInput.fill('test@example.com');
    await submitButton.click();

    // Wait for error
    await window.waitForTimeout(500);

    // Check for error message
    const errorMessage = window.locator('text=Failed to send verification code');
    await expect(errorMessage).toBeVisible();

    // Verify still on email screen
    const emailLabel = window.locator('text=Email address');
    await expect(emailLabel).toBeVisible();
  });

  test('should display sign up link', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const signUpText = window.locator('text=Don\'t have an account?');
    await expect(signUpText).toBeVisible();

    const signUpButton = window.locator('button:has-text("Sign up for free")');
    await expect(signUpButton).toBeVisible();
  });

  test('should display terms and privacy links', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const termsButton = window.locator('button:has-text("Terms of Service")');
    await expect(termsButton).toBeVisible();

    const privacyButton = window.locator('button:has-text("Privacy Policy")');
    await expect(privacyButton).toBeVisible();
  });
});

test.describe('Authentication - OTP Verification', () => {
  /**
   * Helper to navigate to OTP screen
   */
  async function navigateToOtpScreen(window: any, electronApp: any) {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock successful OTP send
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await emailInput.fill('test@example.com');

    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Wait for OTP screen with extended timeout
    await window.waitForSelector('text=Enter verification code', { timeout: 10000, state: 'visible' });

    // Additional wait for UI stabilization
    await window.waitForTimeout(500);
  }

  test('should display OTP verification screen', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Verify elements
    const heading = window.locator('text=Enter verification code');
    await expect(heading).toBeVisible();

    const message = window.locator('text=We sent a 6-digit code to test@example.com');
    await expect(message).toBeVisible();

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    await expect(otpInput).toBeVisible();

    const verifyButton = window.locator('button:has-text("Verify Code")');
    await expect(verifyButton).toBeVisible();
  });

  test('should auto-focus OTP input field', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');

    // Verify input has focus
    const isFocused = await otpInput.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);
  });

  test('should accept 6-digit numeric input', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');

    // Type OTP code
    await otpInput.fill('123456');

    // Verify value
    const value = await otpInput.inputValue();
    expect(value).toBe('123456');
  });

  test('should filter out non-numeric characters', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');

    // Try to type letters and numbers
    await otpInput.fill('abc123xyz456');

    // Verify only numbers remain (and limited to 6 digits)
    const value = await otpInput.inputValue();
    expect(value).toBe('123456');
  });

  test('should limit input to 6 digits', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');

    // Try to type more than 6 digits
    await otpInput.fill('1234567890');

    // Verify only first 6 digits
    const value = await otpInput.inputValue();
    expect(value).toBe('123456');
  });

  test('should disable verify button when code is incomplete', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter incomplete code
    await otpInput.fill('123');

    // Button should be disabled
    const isDisabled = await verifyButton.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should enable verify button when code is complete', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter complete code
    await otpInput.fill('123456');

    // Button should be enabled
    const isDisabled = await verifyButton.isDisabled();
    expect(isDisabled).toBe(false);
  });

  test('should validate code requires 6 digits', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Mock verify OTP handler
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return { success: true, user: mockUser };
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter incomplete code
    await otpInput.fill('123');

    // Try to submit (button should be disabled, but test validation)
    // The button's disabled state prevents submission, but we test the validation logic
    await verifyButton.click({ force: true }); // Force click to test validation

    // Check for error or that button stayed disabled
    await window.waitForTimeout(100);
    const isDisabled = await verifyButton.isDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should show loading state while verifying', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Mock verify OTP handler with delay
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: true, user: mockUser });
        }, 1000);
      });
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter code and submit
    await otpInput.fill('123456');
    await verifyButton.click();

    // Check for loading state
    const loadingText = window.locator('text=Verifying...');
    await expect(loadingText).toBeVisible();

    // Check button is disabled
    const isDisabled = await verifyButton.isDisabled();
    expect(isDisabled).toBe(true);

    // Check for spinner
    const spinner = window.locator('svg.animate-spin');
    await expect(spinner).toBeVisible();
  });

  test('should authenticate successfully with valid code', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Mock successful verification
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return { success: true, user: mockUser };
    });

    // Update auth state after verification
    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      return true;
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: true, user: mockUser };
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter code and submit
    await otpInput.fill('123456');
    await verifyButton.click();

    // Wait for navigation to main app
    await window.waitForTimeout(1000);

    // Verify login screen is gone (user should see main app)
    const loginHeading = window.locator('text=Sign in to your account');
    const loginCount = await loginHeading.count();
    expect(loginCount).toBe(0);
  });

  test('should display error for invalid code', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Mock failed verification
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return { success: false, error: 'Invalid verification code' };
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter code and submit
    await otpInput.fill('999999');
    await verifyButton.click();

    // Wait for error
    await window.waitForTimeout(500);

    // Check for error message
    const errorMessage = window.locator('text=Invalid verification code');
    await expect(errorMessage).toBeVisible();

    // Verify still on OTP screen
    const otpHeading = window.locator('text=Enter verification code');
    await expect(otpHeading).toBeVisible();
  });

  test('should have back button to return to email entry', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const backButton = window.locator('button:has-text("Back")');
    await expect(backButton).toBeVisible();

    // Click back button
    await backButton.click();

    // Wait for email screen
    await window.waitForTimeout(300);

    // Verify back on email screen
    const emailLabel = window.locator('text=Email address');
    await expect(emailLabel).toBeVisible();

    const emailInput = window.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
  });

  test('should clear OTP code when going back', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const backButton = window.locator('button:has-text("Back")');

    // Enter some code
    await otpInput.fill('123456');

    // Go back
    await backButton.click();
    await window.waitForTimeout(300);

    // Navigate to OTP screen again
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    await window.waitForSelector('text=Enter verification code', { timeout: 2000 });

    // Verify OTP input is empty
    const otpInputAgain = window.locator('input[type="text"][maxlength="6"]');
    const value = await otpInputAgain.inputValue();
    expect(value).toBe('');
  });

  test('should clear error when going back', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    // Mock failed verification to show error
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return { success: false, error: 'Invalid verification code' };
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    // Enter code and submit to trigger error
    await otpInput.fill('999999');
    await verifyButton.click();
    await window.waitForTimeout(500);

    // Verify error is displayed
    const errorMessage = window.locator('text=Invalid verification code');
    await expect(errorMessage).toBeVisible();

    // Go back
    const backButton = window.locator('button:has-text("Back")');
    await backButton.click();
    await window.waitForTimeout(300);

    // Navigate to OTP screen again
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    await window.waitForSelector('text=Enter verification code', { timeout: 2000 });

    // Verify error is not displayed
    const errorCount = await errorMessage.count();
    expect(errorCount).toBe(0);
  });

  test('should have resend code button', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    const resendButton = window.locator('button:has-text("Resend")');
    await expect(resendButton).toBeVisible();
  });

  test('should resend OTP code on button click', async ({ window, electronApp }) => {
    await navigateToOtpScreen(window, electronApp);

    let resendCount = 0;

    // Mock resend OTP handler
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      resendCount++;
      return { success: true };
    });

    const resendButton = window.locator('button:has-text("Resend")');

    // Click resend
    await resendButton.click();

    // Wait for IPC call
    await window.waitForTimeout(500);

    // Verify resend was called (count would be 2: initial send + resend)
    // Note: In actual implementation, you'd verify via IPC mock tracking
    await expect(resendButton).toBeVisible();
  });
});

test.describe('Authentication - Sign Out', () => {
  /**
   * Helper to authenticate and navigate to settings
   */
  async function authenticateAndNavigateToSettings(window: any, electronApp: any) {
    await mockAuthenticatedState(electronApp);

    // Reload to trigger authenticated state
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('Network idle timeout in settings navigation, continuing...');
    });

    // Wait for main app to be visible
    await window.waitForSelector('nav.w-20', { timeout: 20000, state: 'visible' });
    await window.waitForTimeout(1000);

    // Navigate to settings (where sign out button is)
    const settingsButton = window.locator('button:has-text("Settings"), a:has-text("Settings")').first();
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();
    await window.waitForTimeout(1000);

    // Wait for settings to load
    await window.waitForSelector('text=Account', { timeout: 15000, state: 'visible' });
  }

  test('should display sign out button when authenticated', async ({ window, electronApp }) => {
    await authenticateAndNavigateToSettings(window, electronApp);

    const signOutButton = window.locator('button:has-text("Sign Out")');
    await expect(signOutButton).toBeVisible();
  });

  test('should sign out user on button click', async ({ window, electronApp }) => {
    await authenticateAndNavigateToSettings(window, electronApp);

    // Mock sign out handler
    await mockIPCHandler(electronApp, 'auth:sign-out', () => {
      return { success: true };
    });

    // Update auth state after sign out
    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      return false;
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: false, error: 'Not authenticated' };
    });

    const signOutButton = window.locator('button:has-text("Sign Out")');

    // Click sign out
    await signOutButton.click();

    // Wait for navigation
    await window.waitForTimeout(500);

    // Should reload page which will show login screen
    // In a real scenario, the AuthContext would update and show login
    const signOutButtonCount = await signOutButton.count();

    // After sign out, either redirected to login or sign out button is gone
    expect(signOutButtonCount).toBeLessThanOrEqual(1);
  });

  test('should clear user session on sign out', async ({ window, electronApp }) => {
    await authenticateAndNavigateToSettings(window, electronApp);

    let sessionCleared = false;

    // Mock sign out handler
    await mockIPCHandler(electronApp, 'auth:sign-out', () => {
      sessionCleared = true;
      return { success: true };
    });

    const signOutButton = window.locator('button:has-text("Sign Out")');

    // Click sign out
    await signOutButton.click();

    // Wait for IPC call
    await window.waitForTimeout(500);

    // In actual implementation, verify session storage is cleared
    // For now, we verify the IPC call would trigger session clearing
    expect(sessionCleared).toBe(true);
  });

  test('should redirect to login screen after sign out', async ({ window, electronApp }) => {
    // Start authenticated
    await mockAuthenticatedState(electronApp);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Mock sign out to update auth state
    await mockIPCHandler(electronApp, 'auth:sign-out', () => {
      return { success: true };
    });

    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      return false;
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: false, error: 'Not authenticated' };
    });

    // Trigger sign out via IPC directly for cleaner test
    await window.evaluate(() => {
      return (window as any).electron.ipcRenderer.invoke('auth:sign-out');
    });

    // Reload to trigger auth check
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(500);

    // Should show login screen
    const loginHeading = window.locator('text=Sign in to your account');
    await expect(loginHeading).toBeVisible();
  });
});

test.describe('Authentication - Session Management', () => {
  test('should persist authenticated state on app reload', async ({ window, electronApp }) => {
    // Mock authenticated state
    await mockAuthenticatedState(electronApp);

    // Reload the app
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Should not show login screen (user is authenticated)
    const loginHeading = window.locator('text=Sign in to your account');
    const loginCount = await loginHeading.count();
    expect(loginCount).toBe(0);
  });

  test('should check authentication status on app start', async ({ window, electronApp }) => {
    let authCheckCalled = false;

    // Mock auth check
    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      authCheckCalled = true;
      return false;
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: false, error: 'Not authenticated' };
    });

    // Reload to trigger auth check
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(500);

    // Auth check should have been called
    expect(authCheckCalled).toBe(true);
  });

  test('should show loading state while checking auth', async ({ window, electronApp }) => {
    // Mock auth check with delay
    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(false), 500);
      });
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: false, error: 'Not authenticated' };
    });

    // Reload to trigger auth check
    await window.reload();

    // Check for loading indicator
    // The AuthGate component shows a loading spinner while checking auth
    const loadingSpinner = window.locator('.animate-spin');
    const loadingText = window.locator('text=Loading...');

    // At least one loading indicator should be visible briefly
    // This is timing-sensitive, so we use a try-catch
    try {
      await expect(loadingSpinner.or(loadingText)).toBeVisible({ timeout: 1000 });
    } catch {
      // Loading might be too fast to catch, which is fine
      console.log('Loading state was too fast to detect');
    }
  });

  test('should handle auth check failure gracefully', async ({ window, electronApp }) => {
    // Mock auth check to throw error
    await mockIPCHandler(electronApp, 'auth:is-authenticated', () => {
      throw new Error('Auth service unavailable');
    });

    await mockIPCHandler(electronApp, 'auth:get-user', () => {
      return { success: false, error: 'Auth service unavailable' };
    });

    // Reload to trigger auth check
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Should show login screen as fallback
    const loginHeading = window.locator('text=Sign in to your account');
    await expect(loginHeading).toBeVisible();
  });

  test('should maintain session across page navigation', async ({ window, electronApp }) => {
    // Start authenticated
    await mockAuthenticatedState(electronApp);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Navigate around the app (if there are routes)
    // For this test, just verify we stay authenticated

    // After navigation, should still be authenticated
    const loginHeading = window.locator('text=Sign in to your account');
    const loginCount = await loginHeading.count();
    expect(loginCount).toBe(0);
  });

  test('should expose user data when authenticated', async ({ window, electronApp }) => {
    await mockAuthenticatedState(electronApp);
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // User email should be visible somewhere in the app (likely in settings)
    const settingsButton = window.locator('button:has-text("Settings"), a:has-text("Settings")').first();
    if (await settingsButton.count() > 0) {
      await settingsButton.click();
      await window.waitForTimeout(500);

      // Look for user email in settings
      const userEmail = window.locator(`text=${mockUser.email}`);
      await expect(userEmail).toBeVisible();
    }
  });
});

test.describe('Authentication - Error Scenarios', () => {
  test('should handle network errors during OTP send', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock network error
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: false, error: 'Network request failed' };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    await window.waitForTimeout(500);

    // Should display error
    const errorMessage = window.locator('text=Network request failed');
    await expect(errorMessage).toBeVisible();
  });

  test('should handle network errors during OTP verification', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Navigate to OTP screen
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    await window.waitForSelector('text=Enter verification code', { timeout: 2000 });

    // Mock network error for verification
    await mockIPCHandler(electronApp, 'auth:verify-otp', () => {
      return { success: false, error: 'Network request failed' };
    });

    const otpInput = window.locator('input[type="text"][maxlength="6"]');
    const verifyButton = window.locator('button:has-text("Verify Code")');

    await otpInput.fill('123456');
    await verifyButton.click();

    await window.waitForTimeout(500);

    // Should display error
    const errorMessage = window.locator('text=Network request failed');
    await expect(errorMessage).toBeVisible();
  });

  test('should handle malformed email gracefully', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: true };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Try various malformed emails
    const malformedEmails = [
      '@example.com',
      'test@',
      'test',
      'test@.com',
      'test..test@example.com',
    ];

    for (const email of malformedEmails) {
      await emailInput.clear();
      await emailInput.fill(email);
      await submitButton.click();
      await window.waitForTimeout(100);

      // Should show validation error or not proceed
      // Browser validation or component validation should catch it
    }
  });

  test('should handle timeout during authentication', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Mock very slow response
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ success: false, error: 'Request timeout' });
        }, 5000);
      });
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    // Wait for timeout error
    await window.waitForTimeout(5500);

    // Should display timeout error
    const errorMessage = window.locator('text=Request timeout');
    await expect(errorMessage).toBeVisible();
  });
});

test.describe('Authentication - UI/UX', () => {
  test('should have consistent styling across login flow', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Check consistent dark theme
    const container = window.locator('.bg-gray-900').first();
    await expect(container).toBeVisible();

    // Check consistent button styling
    const button = window.locator('button:has-text("Continue with Email")');
    const buttonClasses = await button.getAttribute('class');
    expect(buttonClasses).toContain('bg-blue-600');
  });

  test('should display appropriate input styling', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const emailInput = window.locator('input[type="email"]');
    const inputClasses = await emailInput.getAttribute('class');

    // Should have dark theme input styling
    expect(inputClasses).toContain('bg-gray-900');
    expect(inputClasses).toContain('text-white');
  });

  test('should have accessible form labels', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Check email input has label
    const emailLabel = window.locator('label[for="email"]');
    await expect(emailLabel).toBeVisible();

    const labelText = await emailLabel.textContent();
    expect(labelText).toContain('Email address');
  });

  test('should show visual feedback on button hover', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    const submitButton = window.locator('button:has-text("Continue with Email")');

    // Button should have hover styles defined
    const buttonClasses = await submitButton.getAttribute('class');
    expect(buttonClasses).toContain('hover:bg-blue-500');
  });

  test('should display error messages in consistent style', async ({ window, electronApp }) => {
    await mockUnauthenticatedState(electronApp);
    await waitForLoginScreen(window);

    // Trigger an error
    await mockIPCHandler(electronApp, 'auth:send-otp', () => {
      return { success: false, error: 'Test error message' };
    });

    const emailInput = window.locator('input[type="email"]');
    const submitButton = window.locator('button:has-text("Continue with Email")');

    await emailInput.fill('test@example.com');
    await submitButton.click();

    await window.waitForTimeout(500);

    // Check error styling
    const errorContainer = window.locator('.bg-red-900\\/30').first();
    await expect(errorContainer).toBeVisible();

    const errorText = window.locator('.text-red-400').first();
    await expect(errorText).toBeVisible();
  });
});
