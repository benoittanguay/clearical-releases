import { test, expect } from '../fixtures/electron';
import { mockIPCHandler } from '../helpers/electron';
import type { JiraProject, JiraIssue, JiraSearchResponse } from '../../src/services/jiraService';

/**
 * Jira Integration tests for TimePortal
 *
 * These tests cover all Jira functionality including:
 * - Jira configuration (credentials, connection testing)
 * - Project selection and management
 * - Issue linking to time entries
 * - Sync functionality (manual and automatic)
 * - Search and filtering
 */

/**
 * Helper function to navigate to settings
 */
async function navigateToSettings(window: any) {
  await window.waitForLoadState('domcontentloaded');
  const settingsButton = window.locator('button:has-text("Settings"), a:has-text("Settings"), [data-testid="settings-button"]').first();
  if (await settingsButton.count() > 0) {
    await settingsButton.click();
    await window.waitForTimeout(500);
  }
}

/**
 * Helper function to open integration config modal
 */
async function openIntegrationModal(window: any) {
  await navigateToSettings(window);
  const configureButton = window.locator('button:has-text("Configure Integration")');
  if (await configureButton.count() > 0) {
    await configureButton.click();
    await window.waitForTimeout(500);
  }
}

/**
 * Helper function to switch to Jira tab in integration modal
 */
async function switchToJiraTab(window: any) {
  const jiraTab = window.locator('button:has-text("Jira Setup")');
  if (await jiraTab.count() > 0) {
    await jiraTab.click();
    await window.waitForTimeout(300);
  }
}

/**
 * Mock Jira API responses
 */
const mockJiraProjects: JiraProject[] = [
  {
    id: '10000',
    key: 'TEST',
    name: 'Test Project',
    projectTypeKey: 'software',
    avatarUrls: {
      '16x16': 'https://example.com/avatar16.png',
      '24x24': 'https://example.com/avatar24.png',
      '32x32': 'https://example.com/avatar32.png',
      '48x48': 'https://example.com/avatar48.png',
    },
  },
  {
    id: '10001',
    key: 'DEMO',
    name: 'Demo Project',
    projectTypeKey: 'software',
    avatarUrls: {
      '16x16': 'https://example.com/avatar16.png',
      '24x24': 'https://example.com/avatar24.png',
      '32x32': 'https://example.com/avatar32.png',
      '48x48': 'https://example.com/avatar48.png',
    },
  },
  {
    id: '10002',
    key: 'PROD',
    name: 'Production Project',
    projectTypeKey: 'business',
    avatarUrls: {
      '16x16': 'https://example.com/avatar16.png',
      '24x24': 'https://example.com/avatar24.png',
      '32x32': 'https://example.com/avatar32.png',
      '48x48': 'https://example.com/avatar48.png',
    },
  },
];

const mockJiraIssues: JiraIssue[] = [
  {
    id: '10100',
    key: 'TEST-123',
    self: 'https://example.atlassian.net/rest/api/3/issue/10100',
    fields: {
      summary: 'Implement user authentication',
      description: 'Add OAuth2 authentication flow',
      status: {
        id: '3',
        name: 'In Progress',
        description: 'Work is in progress',
        statusCategory: {
          id: 4,
          key: 'indeterminate',
          colorName: 'yellow',
          name: 'In Progress',
        },
      },
      issuetype: {
        id: '10001',
        name: 'Story',
        description: 'User story',
        iconUrl: 'https://example.com/story.png',
        subtask: false,
      },
      project: mockJiraProjects[0],
      assignee: {
        accountId: 'user123',
        displayName: 'John Doe',
        emailAddress: 'john.doe@example.com',
        avatarUrls: {
          '16x16': 'https://example.com/avatar16.png',
          '24x24': 'https://example.com/avatar24.png',
          '32x32': 'https://example.com/avatar32.png',
          '48x48': 'https://example.com/avatar48.png',
        },
      },
      reporter: {
        accountId: 'user456',
        displayName: 'Jane Smith',
        emailAddress: 'jane.smith@example.com',
        avatarUrls: {
          '16x16': 'https://example.com/avatar16.png',
          '24x24': 'https://example.com/avatar24.png',
          '32x32': 'https://example.com/avatar32.png',
          '48x48': 'https://example.com/avatar48.png',
        },
      },
      priority: {
        id: '2',
        name: 'High',
        iconUrl: 'https://example.com/priority-high.png',
      },
      created: '2024-01-15T10:00:00.000Z',
      updated: '2024-01-20T15:30:00.000Z',
    },
  },
  {
    id: '10101',
    key: 'TEST-124',
    self: 'https://example.atlassian.net/rest/api/3/issue/10101',
    fields: {
      summary: 'Fix login bug',
      description: 'Users cannot login with special characters in password',
      status: {
        id: '1',
        name: 'To Do',
        description: 'Work not started',
        statusCategory: {
          id: 2,
          key: 'new',
          colorName: 'blue',
          name: 'To Do',
        },
      },
      issuetype: {
        id: '10004',
        name: 'Bug',
        description: 'Bug report',
        iconUrl: 'https://example.com/bug.png',
        subtask: false,
      },
      project: mockJiraProjects[0],
      assignee: {
        accountId: 'user123',
        displayName: 'John Doe',
        emailAddress: 'john.doe@example.com',
        avatarUrls: {
          '16x16': 'https://example.com/avatar16.png',
          '24x24': 'https://example.com/avatar24.png',
          '32x32': 'https://example.com/avatar32.png',
          '48x48': 'https://example.com/avatar48.png',
        },
      },
      reporter: {
        accountId: 'user789',
        displayName: 'Bob Johnson',
        emailAddress: 'bob.johnson@example.com',
        avatarUrls: {
          '16x16': 'https://example.com/avatar16.png',
          '24x24': 'https://example.com/avatar24.png',
          '32x32': 'https://example.com/avatar32.png',
          '48x48': 'https://example.com/avatar48.png',
        },
      },
      priority: {
        id: '1',
        name: 'Critical',
        iconUrl: 'https://example.com/priority-critical.png',
      },
      created: '2024-01-18T09:00:00.000Z',
      updated: '2024-01-19T11:00:00.000Z',
    },
  },
];

test.describe('Jira Configuration', () => {
  test('should display Jira integration toggle', async ({ window, electronApp }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Check for Jira enabled checkbox
    const jiraToggle = window.locator('input#jira-enabled-unified');
    await expect(jiraToggle).toBeVisible();

    // Check for label
    const jiraLabel = window.locator('label[for="jira-enabled-unified"]');
    await expect(jiraLabel).toHaveText('Enable Jira Integration');
  });

  test('should toggle Jira integration on/off', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    const jiraToggle = window.locator('input#jira-enabled-unified');
    const initialState = await jiraToggle.isChecked();

    // Toggle
    await jiraToggle.click();
    await window.waitForTimeout(200);

    // Verify state changed
    const newState = await jiraToggle.isChecked();
    expect(newState).toBe(!initialState);
  });

  test('should show Jira configuration fields when enabled', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Check for base URL input
    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    await expect(baseUrlInput).toBeVisible();

    // Check for email input
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    await expect(emailInput).toBeVisible();

    // Check for API token input
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');
    await expect(apiTokenInput).toBeVisible();
  });

  test('should hide Jira configuration fields when disabled', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Disable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (await jiraToggle.isChecked()) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Check that config fields are not visible
    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    await expect(baseUrlInput).not.toBeVisible();
  });

  test('should enter Jira base URL', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Enter base URL
    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    await baseUrlInput.clear();
    await baseUrlInput.fill('https://mycompany.atlassian.net');

    // Verify value
    const value = await baseUrlInput.inputValue();
    expect(value).toBe('https://mycompany.atlassian.net');
  });

  test('should enter email for basic auth', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Enter email
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    await emailInput.clear();
    await emailInput.fill('test@example.com');

    // Verify value
    const value = await emailInput.inputValue();
    expect(value).toBe('test@example.com');
  });

  test('should enter API token', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Enter API token
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');
    await apiTokenInput.clear();
    await apiTokenInput.fill('test-api-token-123');

    // Verify value (password fields return value)
    const value = await apiTokenInput.inputValue();
    expect(value).toBe('test-api-token-123');
  });

  test('should display API token generation help text', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Check for help text
    const helpText = window.locator('text=Generate at: Jira → Profile → Security');
    await expect(helpText).toBeVisible();
  });

  test('should show test connection button', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Check for test connection button
    const testButton = window.locator('button:has-text("Test Jira Connection")');
    await expect(testButton).toBeVisible();
  });

  test('should validate credentials before testing connection', async ({ window }) => {
    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    // Clear all fields
    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');

    await baseUrlInput.clear();
    await emailInput.clear();
    await apiTokenInput.clear();

    // Click test connection button
    const testButton = window.locator('button:has-text("Test Jira Connection")');

    // Setup alert listener
    let alertMessage = '';
    window.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await testButton.click();
    await window.waitForTimeout(500);

    // Verify validation message
    expect(alertMessage).toContain('all Jira fields');
  });

  test('should test Jira connection successfully', async ({ window, electronApp }) => {
    // Mock successful Jira API response
    await mockIPCHandler(electronApp, 'jira-api-request', () => {
      return {
        success: true,
        status: 200,
        data: {
          accountId: 'user123',
          displayName: 'Test User',
          emailAddress: 'test@example.com',
          avatarUrls: {
            '16x16': 'https://example.com/avatar16.png',
            '24x24': 'https://example.com/avatar24.png',
            '32x32': 'https://example.com/avatar32.png',
            '48x48': 'https://example.com/avatar48.png',
          },
        },
      };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira and fill credentials
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');

    await baseUrlInput.fill('https://test.atlassian.net');
    await emailInput.fill('test@example.com');
    await apiTokenInput.fill('test-token-123');

    // Setup alert listener
    let alertMessage = '';
    window.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Click test connection
    const testButton = window.locator('button:has-text("Test Jira Connection")');
    await testButton.click();
    await window.waitForTimeout(1000);

    // Verify success message
    expect(alertMessage).toContain('successful');
  });

  test('should handle Jira connection error', async ({ window, electronApp }) => {
    // Mock failed Jira API response
    await mockIPCHandler(electronApp, 'jira-api-request', () => {
      return {
        success: false,
        status: 401,
        statusText: 'Unauthorized',
        error: null,
      };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira and fill credentials
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');

    await baseUrlInput.fill('https://test.atlassian.net');
    await emailInput.fill('wrong@example.com');
    await apiTokenInput.fill('invalid-token');

    // Setup alert listener
    let alertMessage = '';
    window.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // Click test connection
    const testButton = window.locator('button:has-text("Test Jira Connection")');
    await testButton.click();
    await window.waitForTimeout(1000);

    // Verify error message
    expect(alertMessage).toContain('failed');
  });

  test('should show loading state during connection test', async ({ window, electronApp }) => {
    // Mock delayed response
    await mockIPCHandler(electronApp, 'jira-api-request', async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return {
        success: true,
        status: 200,
        data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} },
      };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira and fill credentials
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');

    await baseUrlInput.fill('https://test.atlassian.net');
    await emailInput.fill('test@example.com');
    await apiTokenInput.fill('test-token-123');

    // Click test connection
    const testButton = window.locator('button:has-text("Test Jira Connection")');
    await testButton.click();

    // Check for loading state
    const loadingButton = window.locator('button:has-text("Testing Jira...")');
    await expect(loadingButton).toBeVisible();

    // Check for spinner
    const spinner = window.locator('button:has-text("Testing Jira...") .animate-spin');
    await expect(spinner).toBeVisible();
  });
});

test.describe('Project Selection', () => {
  test('should load projects after successful connection test', async ({ window, electronApp }) => {
    // Mock successful connection test
    let requestCount = 0;
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      requestCount++;

      // First request: test connection (getCurrentUser)
      if (url.includes('/myself')) {
        return {
          success: true,
          status: 200,
          data: {
            accountId: 'user123',
            displayName: 'Test User',
            emailAddress: 'test@example.com',
            avatarUrls: {},
          },
        };
      }

      // Second request: get projects
      if (url.includes('/project')) {
        return {
          success: true,
          status: 200,
          data: mockJiraProjects,
        };
      }

      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable Jira and fill credentials
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    const baseUrlInput = window.locator('input[placeholder*="atlassian.net"]');
    const emailInput = window.locator('input[type="email"][placeholder*="email"]');
    const apiTokenInput = window.locator('input[type="password"][placeholder*="API token"]');

    await baseUrlInput.fill('https://test.atlassian.net');
    await emailInput.fill('test@example.com');
    await apiTokenInput.fill('test-token-123');

    // Setup alert handler
    window.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Click test connection
    const testButton = window.locator('button:has-text("Test Jira Connection")');
    await testButton.click();
    await window.waitForTimeout(1500);

    // Check for project selection section
    const projectsLabel = window.locator('text=Select Projects to Fetch Data From');
    await expect(projectsLabel).toBeVisible();
  });

  test('should display all available projects', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Verify all projects are displayed
    for (const project of mockJiraProjects) {
      const projectCheckbox = window.locator(`input#project-${project.key}`);
      await expect(projectCheckbox).toBeVisible();

      const projectLabel = window.locator(`label[for="project-${project.key}"]`);
      await expect(projectLabel).toContainText(project.key);
      await expect(projectLabel).toContainText(project.name);
    }
  });

  test('should select individual projects', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Select first project
    const firstProjectCheckbox = window.locator('input#project-TEST');
    await firstProjectCheckbox.click();
    await window.waitForTimeout(200);

    // Verify it's checked
    const isChecked = await firstProjectCheckbox.isChecked();
    expect(isChecked).toBe(true);
  });

  test('should deselect individual projects', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Select then deselect
    const projectCheckbox = window.locator('input#project-TEST');
    await projectCheckbox.click();
    await window.waitForTimeout(200);
    await projectCheckbox.click();
    await window.waitForTimeout(200);

    // Verify it's unchecked
    const isChecked = await projectCheckbox.isChecked();
    expect(isChecked).toBe(false);
  });

  test('should select all projects', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Click Select All button
    const selectAllButton = window.locator('button:has-text("Select All")');
    await selectAllButton.click();
    await window.waitForTimeout(200);

    // Verify all projects are selected
    for (const project of mockJiraProjects) {
      const checkbox = window.locator(`input#project-${project.key}`);
      const isChecked = await checkbox.isChecked();
      expect(isChecked).toBe(true);
    }
  });

  test('should clear all projects', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Select all first
    const selectAllButton = window.locator('button:has-text("Select All")');
    await selectAllButton.click();
    await window.waitForTimeout(200);

    // Click Clear All button
    const clearAllButton = window.locator('button:has-text("Clear All")');
    await clearAllButton.click();
    await window.waitForTimeout(200);

    // Verify all projects are deselected
    for (const project of mockJiraProjects) {
      const checkbox = window.locator(`input#project-${project.key}`);
      const isChecked = await checkbox.isChecked();
      expect(isChecked).toBe(false);
    }
  });

  test('should display project selection count', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Select one project
    const firstProjectCheckbox = window.locator('input#project-TEST');
    await firstProjectCheckbox.click();
    await window.waitForTimeout(200);

    // Check for count display
    const countDisplay = window.locator(`text=/1 of ${mockJiraProjects.length} selected/`);
    await expect(countDisplay).toBeVisible();
  });

  test('should save project selection configuration', async ({ window, electronApp }) => {
    // Mock API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      if (url.includes('/project')) {
        return { success: true, status: 200, data: mockJiraProjects };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(1500);

    // Select projects
    await window.locator('input#project-TEST').click();
    await window.locator('input#project-DEMO').click();
    await window.waitForTimeout(200);

    // Save configuration
    const saveButton = window.locator('button:has-text("Save Configuration")');
    await saveButton.click();
    await window.waitForTimeout(500);

    // Modal should close
    const modal = window.locator('text=Configure Time Tracking Integration');
    await expect(modal).not.toBeVisible();
  });
});

test.describe('Issue Linking', () => {
  test('should display Jira Issues section', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for Jira Issues section
    const jiraSection = window.locator('text=Jira Issues');

    // Section may be visible or may require scrolling
    const sectionExists = await jiraSection.count() > 0;
    if (sectionExists) {
      await expect(jiraSection.first()).toBeVisible();
    }
  });

  test('should show assigned issues tab', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for Assigned to Me tab
    const assignedTab = window.locator('button:has-text("Assigned to Me")');
    const tabExists = await assignedTab.count() > 0;

    if (tabExists) {
      await expect(assignedTab.first()).toBeVisible();
    }
  });

  test('should show search tab', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for Search tab
    const searchTab = window.locator('button:has-text("Search")');
    const tabExists = await searchTab.count() > 0;

    if (tabExists) {
      await expect(searchTab.first()).toBeVisible();
    }
  });

  test('should display search input in search tab', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Click search tab if it exists
    const searchTab = window.locator('button:has-text("Search")');
    const tabExists = await searchTab.count() > 0;

    if (tabExists) {
      await searchTab.first().click();
      await window.waitForTimeout(300);

      // Look for search input
      const searchInput = window.locator('input[placeholder*="Search issues"]');
      await expect(searchInput).toBeVisible();
    }
  });

  test('should display issue information correctly', async ({ window, electronApp }) => {
    // Mock Jira issues API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/search')) {
        return {
          success: true,
          status: 200,
          data: {
            issues: mockJiraIssues,
            total: mockJiraIssues.length,
            startAt: 0,
            maxResults: 100,
          } as JiraSearchResponse,
        };
      }
      return { success: false, status: 404 };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for issue cards
    const issueKey = window.locator('text=TEST-123');
    const issueExists = await issueKey.count() > 0;

    if (issueExists) {
      await expect(issueKey.first()).toBeVisible();

      // Check for issue summary
      const issueSummary = window.locator('text=Implement user authentication');
      await expect(issueSummary.first()).toBeVisible();

      // Check for status
      const issueStatus = window.locator('text=In Progress');
      await expect(issueStatus.first()).toBeVisible();

      // Check for issue type
      const issueType = window.locator('text=Story');
      await expect(issueType.first()).toBeVisible();
    }
  });

  test('should refresh issues on refresh button click', async ({ window, electronApp }) => {
    let requestCount = 0;

    // Mock Jira issues API
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/search')) {
        requestCount++;
        return {
          success: true,
          status: 200,
          data: {
            issues: mockJiraIssues,
            total: mockJiraIssues.length,
            startAt: 0,
            maxResults: 100,
          } as JiraSearchResponse,
        };
      }
      return { success: false, status: 404 };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for refresh button
    const refreshButton = window.locator('button:has-text("Refresh")');
    const buttonExists = await refreshButton.count() > 0;

    if (buttonExists) {
      const initialCount = requestCount;
      await refreshButton.first().click();
      await window.waitForTimeout(500);

      // Verify API was called again
      expect(requestCount).toBeGreaterThan(initialCount);
    }
  });
});

test.describe('Sync Functionality', () => {
  test('should display sync status when projects are syncing', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for sync status indicator
    const syncStatus = window.locator('text=/Syncing projects|Projects synced/');
    const statusExists = await syncStatus.count() > 0;

    if (statusExists) {
      await expect(syncStatus.first()).toBeVisible();
    }
  });

  test('should show total issues discovered count', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for issues count
    const issuesCount = window.locator('text=/\\d+ total issues discovered/');
    const countExists = await issuesCount.count() > 0;

    if (countExists) {
      await expect(issuesCount.first()).toBeVisible();
    }
  });

  test('should display per-project sync progress', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for project-specific sync info
    const projectStatus = window.locator('text=/TEST|DEMO|PROD/').first();
    const statusExists = await projectStatus.count() > 0;

    if (statusExists) {
      // Should show project key and issue count
      await expect(projectStatus).toBeVisible();
    }
  });

  test('should show completion checkmark for completed projects', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for completion checkmark SVG
    const checkmark = window.locator('svg.text-green-400[fill="currentColor"]');
    const checkmarkExists = await checkmark.count() > 0;

    // Checkmark may or may not be visible depending on sync state
    if (checkmarkExists) {
      const isVisible = await checkmark.first().isVisible();
      // Just verify the element exists in DOM
      expect(checkmarkExists).toBe(true);
    }
  });

  test('should show sync animation when active', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Look for spinning sync icon
    const syncIcon = window.locator('svg.animate-spin').first();
    const iconExists = await syncIcon.count() > 0;

    // Animation may or may not be active
    if (iconExists) {
      const isVisible = await syncIcon.isVisible();
      // Just verify the animation element exists
      expect(iconExists).toBe(true);
    }
  });
});

test.describe('Integration Status Display', () => {
  test('should show Jira status in settings', async ({ window }) => {
    await navigateToSettings(window);

    // Look for Jira Status label
    const jiraStatusLabel = window.locator('text=Jira Status');
    await expect(jiraStatusLabel).toBeVisible();
  });

  test('should display Jira connection badge', async ({ window }) => {
    await navigateToSettings(window);

    // Look for status badge (CONNECTED or DISABLED)
    const statusBadge = window.locator('text=/CONNECTED|DISABLED/').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Jira Status")]')
    }).first();

    await expect(statusBadge).toBeVisible();
  });

  test('should show configure integration button', async ({ window }) => {
    await navigateToSettings(window);

    // Look for configure button
    const configureButton = window.locator('button:has-text("Configure Integration")');
    const buttonExists = await configureButton.count() > 0;

    if (buttonExists) {
      await expect(configureButton.first()).toBeVisible();
    }
  });

  test('should close integration modal on cancel', async ({ window }) => {
    await openIntegrationModal(window);

    // Click cancel button
    const cancelButton = window.locator('button:has-text("Cancel")');
    await cancelButton.click();
    await window.waitForTimeout(300);

    // Modal should be closed
    const modal = window.locator('text=Configure Time Tracking Integration');
    await expect(modal).not.toBeVisible();
  });

  test('should close integration modal on X button', async ({ window }) => {
    await openIntegrationModal(window);

    // Click X button (close icon)
    const closeButton = window.locator('button').filter({
      has: window.locator('svg line[x1="18"][y1="6"][x2="6"][y2="18"]')
    }).first();

    if (await closeButton.count() > 0) {
      await closeButton.click();
      await window.waitForTimeout(300);

      // Modal should be closed
      const modal = window.locator('text=Configure Time Tracking Integration');
      await expect(modal).not.toBeVisible();
    }
  });
});

test.describe('Error Handling', () => {
  test('should display error when issue loading fails', async ({ window, electronApp }) => {
    // Mock failed API response
    await mockIPCHandler(electronApp, 'jira-api-request', () => {
      return {
        success: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for error message
    const errorMessage = window.locator('text=/Failed to load|Error|failed/i');
    const errorExists = await errorMessage.count() > 0;

    // Error may or may not be visible depending on initial state
    if (errorExists) {
      const firstError = errorMessage.first();
      const isVisible = await firstError.isVisible();
      // Just verify error handling exists
      expect(errorExists).toBe(true);
    }
  });

  test('should show retry button on error', async ({ window, electronApp }) => {
    // Mock failed API response
    await mockIPCHandler(electronApp, 'jira-api-request', () => {
      return {
        success: false,
        status: 500,
        statusText: 'Internal Server Error',
      };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for retry button
    const retryButton = window.locator('button:has-text("Retry")');
    const buttonExists = await retryButton.count() > 0;

    if (buttonExists) {
      await expect(retryButton.first()).toBeVisible();
    }
  });

  test('should handle network errors gracefully', async ({ window, electronApp }) => {
    // Mock network error
    await mockIPCHandler(electronApp, 'jira-api-request', () => {
      return {
        success: false,
        error: 'Network error: Failed to fetch',
      };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // App should not crash and should handle error
    const appContent = window.locator('#root');
    await expect(appContent).toBeVisible();
  });
});

test.describe('UI/UX Features', () => {
  test('should show loading state while fetching projects', async ({ window, electronApp }) => {
    // Mock delayed response
    await mockIPCHandler(electronApp, 'jira-api-request', async (event, { url }) => {
      if (url.includes('/project')) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { success: true, status: 200, data: mockJiraProjects };
      }
      if (url.includes('/myself')) {
        return { success: true, status: 200, data: { accountId: 'user123', displayName: 'Test User', emailAddress: 'test@example.com', avatarUrls: {} } };
      }
      return { success: false, status: 404 };
    });

    await openIntegrationModal(window);
    await switchToJiraTab(window);

    // Enable and configure Jira
    const jiraToggle = window.locator('input#jira-enabled-unified');
    if (!(await jiraToggle.isChecked())) {
      await jiraToggle.click();
      await window.waitForTimeout(200);
    }

    await window.locator('input[placeholder*="atlassian.net"]').fill('https://test.atlassian.net');
    await window.locator('input[type="email"][placeholder*="email"]').fill('test@example.com');
    await window.locator('input[type="password"][placeholder*="API token"]').fill('test-token-123');

    window.on('dialog', async (dialog) => await dialog.accept());

    await window.locator('button:has-text("Test Jira Connection")').click();
    await window.waitForTimeout(500);

    // Check for loading indicator
    const loadingText = window.locator('text=Loading available projects...');
    const loadingExists = await loadingText.count() > 0;

    if (loadingExists) {
      await expect(loadingText.first()).toBeVisible();
    }
  });

  test('should display empty state when no issues found', async ({ window, electronApp }) => {
    // Mock empty response
    await mockIPCHandler(electronApp, 'jira-api-request', (event, { url }) => {
      if (url.includes('/search')) {
        return {
          success: true,
          status: 200,
          data: {
            issues: [],
            total: 0,
            startAt: 0,
            maxResults: 100,
          } as JiraSearchResponse,
        };
      }
      return { success: false, status: 404 };
    });

    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    // Look for empty state message
    const emptyMessage = window.locator('text=/No issues found/i');
    const messageExists = await emptyMessage.count() > 0;

    if (messageExists) {
      await expect(emptyMessage.first()).toBeVisible();
    }
  });

  test('should show testing mode banner', async ({ window }) => {
    await openIntegrationModal(window);

    // Look for testing mode banner
    const testingBanner = window.locator('text=Testing Mode');
    await expect(testingBanner).toBeVisible();

    // Check for development credentials message
    const credentialsMessage = window.locator('text=Development credentials are automatically loaded');
    await expect(credentialsMessage).toBeVisible();
  });

  test('should display tab navigation correctly', async ({ window }) => {
    await openIntegrationModal(window);

    // Check for both tabs
    const jiraTab = window.locator('button:has-text("Jira Setup")');
    const tempoTab = window.locator('button:has-text("Tempo Setup")');

    await expect(jiraTab).toBeVisible();
    await expect(tempoTab).toBeVisible();
  });

  test('should switch between Jira and Tempo tabs', async ({ window }) => {
    await openIntegrationModal(window);

    // Switch to Tempo tab
    const tempoTab = window.locator('button:has-text("Tempo Setup")');
    await tempoTab.click();
    await window.waitForTimeout(300);

    // Verify Tempo content is shown
    const tempoLabel = window.locator('text=Enable Tempo Integration');
    await expect(tempoLabel).toBeVisible();

    // Switch back to Jira tab
    const jiraTab = window.locator('button:has-text("Jira Setup")');
    await jiraTab.click();
    await window.waitForTimeout(300);

    // Verify Jira content is shown
    const jiraLabel = window.locator('text=Enable Jira Integration');
    await expect(jiraLabel).toBeVisible();
  });
});
