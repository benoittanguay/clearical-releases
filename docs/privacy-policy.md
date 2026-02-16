# Privacy Policy

**Effective Date:** February 14, 2026
**Last Updated:** February 14, 2026

Clearical Technologies ("we," "us," or "our") operates the Clearical desktop application and website at clearical.io (collectively, the "Service"). This Privacy Policy explains how we collect, use, disclose, and protect your information when you use our Service.

By using Clearical, you agree to the collection and use of information in accordance with this Privacy Policy.

## 1. Information We Collect

### 1.1 Information You Provide

- **Account Information:** Email address used for authentication and account management.
- **Payment Information:** When you subscribe to a paid plan, payment processing is handled by Stripe. We store your Stripe customer ID but do not store credit card numbers or payment details directly.
- **API Credentials:** If you choose to integrate with Jira or Tempo, you provide API tokens for these services. These credentials are encrypted and stored locally on your device.

### 1.2 Information Collected Automatically

When you use Clearical's time tracking features, the application collects:

- **Time Entry Data:** Start and end times, duration of work sessions, and associated notes or descriptions.
- **Window Activity Data:** The name, bundle identifier, and window title of the frontmost application. This data is collected via the macOS Accessibility API (AppleScript `System Events`) to read the title bar text of the active window. No content inside windows is read — only the application name and window title. This is used to automatically generate time entry descriptions (e.g., "Working in Excel — Budget Q3.xlsx").
- **Screenshots:** If you enable screenshot capture, Clearical captures an image of the single active window (not the full screen) using the macOS `CGWindowListCreateImage` API targeted by window ID. Screenshots are encrypted using AES-256-GCM and stored locally on your device. Clearical does not record video or stream screen content.
- **Meeting Audio Recordings:** If you enable the optional meeting recording feature, Clearical records audio from your microphone via the native `AVAudioEngine` API when it detects an active video call (Zoom, Microsoft Teams, Google Meet, etc.). Audio recordings are stored locally on your device. Recordings are transcribed on-device using Apple's `SFSpeechRecognizer` framework, and the resulting text is attached to the relevant time entry as meeting notes. No audio data is streamed or stored externally.
- **AI Analysis Data:** If you enable AI-powered descriptions (premium feature), screenshots may be sent to Google's Gemini API for processing to generate activity descriptions (e.g., "Editing a React component in VS Code"). Images are processed transiently and are not retained by the AI service. This feature is optional and disabled by default.

### 1.3 Device Information

- Device identifier, device name, platform, and operating system version (used for subscription validation across devices).

## 2. How We Use Your Information

We use the information we collect to:

- **Provide the Service:** Enable time tracking, automatic activity descriptions, meeting transcription, and integration with Jira and Tempo.
- **Process Payments:** Manage subscriptions and billing through Stripe.
- **Authenticate Users:** Verify your identity and manage your account.
- **Improve the Service:** Understand how features are used to enhance functionality.
- **Provide AI Features:** Generate activity summaries and classifications using cloud-based AI services (Google Gemini) when the user explicitly opts in.
- **Communicate with You:** Send service-related notifications, updates, and support responses.

## 3. macOS Permissions

Clearical requests the following macOS permissions. Each can be revoked at any time through System Settings > Privacy & Security, which will disable the related features.

### 3.1 Accessibility

Clearical uses the Accessibility API to read the name, bundle identifier, and window title of the frontmost application via AppleScript (`tell application "System Events"`). This is used solely to generate automatic time entry descriptions. Clearical does not inject keystrokes, perform UI automation, or interact with any application controls. No content inside windows is read — only the title bar text.

### 3.2 Screen Recording

Clearical uses the Screen Recording permission to capture a screenshot of the single active window (not the full screen) using `CGWindowListCreateImage()`. Screenshots are captured only while the timer is running, stored locally in the app's sandboxed data directory, and encrypted at rest. Clearical does not record video, stream screen content, or capture when the timer is stopped. Users can blacklist specific applications to prevent any capture.

### 3.3 Microphone

Clearical uses microphone access to record audio during video calls for meeting transcription. Recording is opt-in — the user must explicitly enable auto-recording in settings. Audio is captured via the native `AVAudioEngine` API and transcribed on-device using Apple's `SFSpeechRecognizer` framework. Audio files are stored locally in the app's sandboxed data directory. No audio is streamed or stored externally.

### 3.4 Speech Recognition

Clearical uses on-device speech recognition (`SFSpeechRecognizer`) to transcribe meeting audio recordings into text. Transcription happens entirely on-device. The resulting text is attached to time entries as meeting notes.

## 4. Data Storage and Security

### 4.1 Local Storage

The majority of your data is stored locally on your device:

- **Database:** Time entries, work buckets, and cached data are stored in an SQLite database on your device.
- **Screenshots:** Captured screenshots are encrypted using AES-256-GCM encryption and stored locally. The encryption key is protected by your operating system's secure storage (Keychain on macOS).
- **Audio Recordings:** Meeting recordings are stored locally in the app's sandboxed data directory.
- **API Credentials:** Jira and Tempo API tokens are encrypted using your operating system's secure storage and never transmitted except to authenticate with those services.

### 4.2 Cloud Services

Limited data is transmitted to third-party services:

- **Supabase:** Handles authentication. Stores your email address and authentication tokens.
- **Stripe:** Processes payments. Stores customer ID, subscription status, and payment method details.
- **Google Gemini (Optional):** If you enable AI-powered screenshot analysis, screenshot data may be sent to Google's Gemini API for transient processing. Images are not retained by the service. This feature is optional and disabled by default.

### 4.3 Security Measures

We implement industry-standard security measures including:

- Encryption of sensitive data at rest (AES-256-GCM)
- Encryption of data in transit (HTTPS/TLS)
- Operating system-level credential protection
- Secure session management

## 5. Third-Party Services

Clearical integrates with the following third-party services:

| Service | Purpose | Data Shared |
|---------|---------|-------------|
| Stripe | Payment processing | Email, subscription data |
| Supabase | Authentication | Email, auth tokens |
| Jira (user-configured) | Issue tracking integration | API requests with your credentials |
| Tempo (user-configured) | Time logging integration | Time entries, API requests with your credentials |
| Google Gemini (optional) | AI screenshot analysis | Screenshot images (transient, not retained) |

Each third-party service has its own privacy policy. We encourage you to review them:

- Stripe: https://stripe.com/privacy
- Supabase: https://supabase.com/privacy
- Atlassian (Jira): https://www.atlassian.com/legal/privacy-policy
- Tempo: https://www.tempo.io/privacy-policy
- Google: https://policies.google.com/privacy

## 6. Data Retention

- **Local Data:** Time entries, screenshots, audio recordings, and activity data are retained on your device until you delete them. We do not automatically delete local data.
- **Account Data:** Your account information is retained as long as your account is active. Upon account deletion, we remove your data from our cloud services.
- **Payment Data:** Stripe retains payment information according to their policies and legal requirements.

## 7. Your Rights and Choices

### 7.1 Access and Export

You can export your time tracking data at any time through the application's export feature.

### 7.2 Deletion

- Delete individual time entries, screenshots, and audio recordings within the application.
- Request deletion of your account and associated cloud data by contacting support@clearical.io.

### 7.3 Control Over Data Collection

- **App Blacklisting:** Exclude specific applications from activity tracking and screenshot capture.
- **Screenshot Settings:** Enable, disable, or adjust screenshot capture frequency.
- **Meeting Recording:** Enable or disable automatic meeting recording. This feature is opt-in and disabled by default.
- **AI Features:** Enable or disable AI-powered screenshot analysis.
- **Integrations:** Connect or disconnect Jira and Tempo integrations at any time.

### 7.4 Permissions

On macOS, Clearical requests Accessibility, Screen Recording, Microphone, and Speech Recognition permissions. You can revoke any of these permissions at any time through System Settings > Privacy & Security, which will disable the related features. See Section 3 for details on how each permission is used.

## 8. Children's Privacy

Clearical is not intended for use by individuals under the age of 16. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us at support@clearical.io.

## 9. Analytics and Tracking

Clearical does not use third-party analytics services or tracking cookies. We do not track your usage patterns, share data with advertisers, or build behavioral profiles.

## 10. International Data Transfers

Your data may be processed in countries other than your own when using cloud services (Stripe, Supabase, Google). These services maintain appropriate safeguards for international data transfers.

## 11. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by:

- Posting the new Privacy Policy on this page
- Updating the "Last Updated" date
- Notifying you through the application for significant changes

We encourage you to review this Privacy Policy periodically.

## 12. Quebec Privacy Law Compliance

As a Quebec-based company, we comply with Quebec's Act respecting the protection of personal information in the private sector. You have the right to:

- Access your personal information
- Request correction of inaccurate information
- Withdraw consent to data processing (subject to legal limitations)
- File a complaint with the Commission d'acces a l'information du Quebec

## 13. Contact Us

If you have questions about this Privacy Policy or our privacy practices, please contact us:

Clearical Technologies
Email: support@clearical.io
Website: https://clearical.io
