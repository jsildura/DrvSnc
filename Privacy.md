# Privacy Policy - Drive Link Uploader

**Last Updated**: October 22, 2025  
**Version**: 1.0.0

## Overview

Drive Link Uploader ("the Extension") is designed with privacy as a core principle. This document explains what data is collected, how it's used, and your rights as a user.

## Core Privacy Principles

### 1. No Backend Servers

The Extension operates **entirely client-side**. All file transfers occur directly between:
- Your browser
- The source URL (for URL uploads)
- Google Drive (Google's servers)

**We do not operate any servers.** Your files never pass through any third-party infrastructure controlled by us.

### 2. No Data Collection

We do **not** collect, store, or transmit:
- Personal information
- Usage analytics
- Telemetry data
- Crash reports
- File contents
- File metadata (beyond what's required for the upload)
- Browsing history

### 3. Local Storage Only

All data stored by the Extension remains on **your device**:

| Data Type | Storage Location | Purpose | Retention |
|-----------|------------------|---------|-----------|
| OAuth Tokens | `chrome.storage.session` | Google Drive authentication | Session-only (cleared on browser close) |
| User Preferences | `chrome.storage.local` | Settings (folder, theme, etc.) | Until manually cleared |
| Upload History | `chrome.storage.local` | Show recent uploads | Until manually cleared via Settings |

**No data is synchronized** to any external servers or cloud storage (except Google Drive for your uploads).

## Data Shared with Google

### Google Drive API

When you use the Extension, the following data is sent to **Google's servers** (not ours):

1. **OAuth Token**: Used to authenticate your Google account
2. **File Data**: The actual file content being uploaded
3. **File Metadata**: Filename, destination folder ID, MIME type
4. **API Requests**: Standard HTTP headers (User-Agent, etc.)

This data is governed by:
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

### Scopes Requested

The Extension requests the **minimum necessary scopes**:

- `https://www.googleapis.com/auth/drive.file`  
  *Create and modify files that the Extension creates (not all your files)*

- `https://www.googleapis.com/auth/drive.metadata.readonly`  
  *List your Drive folders for destination selection*

**We cannot access or modify files not created by this Extension.**

## Third-Party Data Sharing

### Summary

**We do not share your data with any third parties.** Period.

### URL Source Servers

When uploading from a URL:
- Your browser makes a direct HTTP request to the source server
- Standard HTTP headers (cookies, referrer) may be sent per browser policy
- The Extension does not add any tracking parameters
- CORS policies are respected

## Permissions Explained

The Extension requests the following Chrome permissions:

| Permission | Purpose |
|------------|---------|
| `identity` | OAuth 2.0 authentication with Google |
| `storage` | Save user preferences and upload history locally |
| `contextMenus` | Add "Save to Drive" option to right-click menu |
| `notifications` | Show upload completion notifications (optional) |
| `offscreen` | Background processing for large uploads |
| `<all_urls>` | Download files from any public URL (subject to CORS) |

### Why `<all_urls>`?

This permission allows the Extension to attempt downloading files from any URL you provide. However:
- It's **subject to CORS restrictions** (most sites will block cross-origin requests)
- The Extension **only** accesses URLs you explicitly provide
- No background browsing or tracking occurs

## Your Rights

### 1. Access Your Data

All stored data is accessible via:
- Chrome DevTools: `chrome://extensions/` → Extension → Inspect service worker → Console → `chrome.storage.local.get()`
- Settings page: View and clear upload history

### 2. Delete Your Data

You can delete all Extension data by:
- **Partial deletion**: Settings → Clear Upload History
- **Full deletion**: `chrome://extensions/` → Remove the Extension
- **OAuth revocation**: [Google Account Security](https://myaccount.google.com/permissions)

### 3. Opt-Out

Simply uninstall the Extension. No residual tracking or data remains.

## Security Measures

### Data Protection

- OAuth tokens stored in session storage (memory-only, cleared on exit)
- No plaintext passwords or credentials stored
- All communication uses HTTPS
- Content Security Policy (CSP) prevents code injection

### File Handling

- Files are processed in memory streams
- No persistent storage of file contents
- Temporary buffers are cleared after upload
- Large files use chunked transfer to minimize memory usage

### Code Integrity

- Open source (inspect the code yourself)
- No obfuscation or minification of sensitive logic
- Regular dependency updates for security patches

## Changes to This Policy

We may update this Privacy Policy to:
- Reflect changes in the Extension's functionality
- Comply with legal requirements
- Improve clarity

**Notification**: Updates will be posted with a new "Last Updated" date. Continued use after updates constitutes acceptance.

## Google API Services User Data Policy Compliance

### Limited Use Disclosure

Drive Link Uploader's use and transfer of information received from Google APIs to any other app will adhere to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes), including the Limited Use requirements.

Specifically:
- **No Selling Data**: We do not sell user data.
- **No Third-Party Transfers**: Data is not transferred to third parties (except Google Drive for uploads).
- **Purpose Limitation**: Data is used solely to provide the Extension's upload functionality.
- **Human Readability**: No AI/ML models access user data.

## Children's Privacy

The Extension is not directed at children under 13. We do not knowingly collect data from children. If you're under 13, please do not use this Extension.

## International Users

Your data is processed:
- On your local device (your country)
- On Google's servers (see [Google's data locations](https://cloud.google.com/security/privacy))

No additional cross-border transfers occur.

## Contact & Questions

If you have privacy concerns or questions:

- **GitHub Issues**: [github.com/yourusername/drive-link-uploader/issues](https://github.com/yourusername/drive-link-uploader/issues)
- **Email**: your-email@example.com

## Legal Basis (GDPR)

For EU/EEA users, we process data based on:
- **Consent**: You grant permission via OAuth flow
- **Legitimate Interest**: Providing core Extension functionality

You have the right to:
- Withdraw consent (uninstall or revoke OAuth)
- Access your data (via Chrome DevTools)
- Delete your data (via Settings or uninstall)
- Data portability (export via Google Takeout for Drive files)

## Disclaimer

THE EXTENSION IS PROVIDED "AS IS" WITHOUT WARRANTY. WE ARE NOT LIABLE FOR:
- Data loss during transfer
- Google Drive quota issues
- Third-party URL availability
- CORS restrictions

**Use at your own risk.** Always keep backups of important files.

---

**Summary**: Drive Link Uploader is a privacy-first tool. Your files go directly from source → Google Drive. We don't see, store, or share anything. All processing happens on your device. Open source, zero tracking, full transparency.

*If you have concerns not addressed here, please open a GitHub issue.*
