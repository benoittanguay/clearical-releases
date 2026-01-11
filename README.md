# Clearical Releases

This repository contains release builds for Clearical.

## Download

**[Download Latest Release](https://github.com/benoittanguay/clearical-releases/releases/latest)**

## macOS Installation

Since the app is not notarized with Apple, macOS will show a security warning on first launch.

### Quick Fix (Terminal)

After downloading, run:

```bash
xattr -cr ~/Downloads/Clearical-arm64.dmg
```

Then open the DMG and install normally.

### Alternative: Right-Click to Open

1. Drag Clearical.app to Applications
2. **Right-click** Clearical → select **Open**
3. Click **Open** in the security dialog

### Alternative: System Settings

1. Try opening the app (it will be blocked)
2. Open **System Settings → Privacy & Security**
3. Click **Open Anyway** next to the Clearical message

This only needs to be done once per installation.

---

Source code is maintained in a private repository.
