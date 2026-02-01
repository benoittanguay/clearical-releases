# Apple Developer Support Ticket - Notarization Stuck in Progress

## Subject
Multiple notarization submissions stuck "In Progress" for 24+ hours

## Team ID
98UY743MSB

## Apple ID
bennyboubou@gmail.com

## Issue Description

Since January 17, 2026, all notarization submissions for our app "Clearical" have been stuck in "In Progress" status indefinitely. Prior to this date, notarization was working normally with quick turnaround times.

## Affected Submissions

| Submission ID | Created Date (UTC) | Status |
|---------------|-------------------|--------|
| 22d6a216-23b4-4843-b4ce-b80696583159 | 2026-01-18T06:46:08 | In Progress |
| 19d3e5a1-52e5-472a-a25d-e706531cc0f5 | 2026-01-18T05:34:31 | In Progress |
| a317d813-bb4d-4818-ae7c-b443a03c69cc | 2026-01-17T15:07:37 | In Progress |
| 70a841c9-8fdc-4cae-a467-5b103f1132e2 | 2026-01-17T03:00:45 | In Progress |

## Last Successful Submission

| Submission ID | Created Date (UTC) | Status |
|---------------|-------------------|--------|
| 4eb93e8c-6f41-4dcf-8e67-c8530c06e1c3 | 2026-01-16T05:58:34 | Accepted |

All submissions from January 14-16 were accepted normally.

## App Details

- **App Name**: Clearical
- **Bundle ID**: io.clearical.app
- **Platform**: macOS (arm64)
- **App Size**: ~217MB (ZIP), ~536MB (uncompressed)
- **Electron Version**: 39.2.7

## Verification Steps Completed

1. **Code signing verified**: `codesign --verify --deep --strict` passes
2. **Signature chain valid**: Developer ID Application → Developer ID Certification Authority → Apple Root CA
3. **Hardened runtime enabled**: flags=0x10000(runtime)
4. **Size within limits**: 217MB ZIP (well under 4GB limit)
5. **Rate limits not exceeded**: Only 4 submissions in 2 days (limit is 75/day)

## Signature Details

```
Identifier=io.clearical.app
CodeDirectory v=20500 size=444 flags=0x10000(runtime) hashes=3+7 location=embedded
Authority=Developer ID Application: Benoit Tanguay (98UY743MSB)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
```

## Submission Command Used

```bash
xcrun notarytool submit Clearical-arm64.zip \
  --apple-id bennyboubou@gmail.com \
  --password [APP_SPECIFIC_PASSWORD] \
  --team-id 98UY743MSB \
  --wait
```

## Expected Behavior

Submissions should complete (either Accepted or Invalid) within minutes to hours, as they did consistently from January 14-16.

## Actual Behavior

Submissions remain in "In Progress" status indefinitely (24+ hours). No logs are available for these submissions when queried with `xcrun notarytool log`.

## Request

Please investigate why our notarization submissions are stuck and either:
1. Process the pending submissions, or
2. Advise if there's an issue with our app bundle that's causing extended analysis

Thank you for your assistance.
