// GitHub Actions workflow integration for remote URL uploads

import type { GitHubConfig } from './githubConfig';

interface WorkflowPayload {
  url: string;
  filename?: string;
  accountKey: string;    // GitHub secret name (e.g., DRIVE_REFRESH_TOKEN_MAIN)
  parentKey?: string;    // Optional folder secret name (deprecated)
  parentFolderId?: string; // Direct folder ID for upload destination
  correlationId: string; // UUID for tracking this specific upload
}

interface WorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral';
  html_url: string;
  created_at: string;
}

interface UploadResult {
  fileId: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
}

/**
 * Trigger GitHub Actions workflow via repository_dispatch
 */
export async function dispatchRemoteUpload(
  config: GitHubConfig,
  payload: WorkflowPayload
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/dispatches`;
  
  console.log('[dispatchRemoteUpload] Config:', {
    owner: config.owner,
    repo: config.repo,
    tokenPrefix: config.token?.substring(0, 20),
    tokenLength: config.token?.length
  });
  console.log('[dispatchRemoteUpload] URL:', url);
  console.log('[dispatchRemoteUpload] Payload:', payload);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      event_type: 'remote-upload',  // Must match workflow types: [remote-upload]
      client_payload: payload
    })
  });

  console.log('[dispatchRemoteUpload] Response status:', response.status);
  
  if (!response.ok) {
    const text = await response.text();
    console.error('[dispatchRemoteUpload] Error response:', text);
    throw new Error(`GitHub dispatch failed: ${response.status} ${text}`);
  }
  
  console.log('[dispatchRemoteUpload] Success!');
}

/**
 * Find workflow run by correlation ID or recent run
 */
export async function findRunByCorrelation(
  config: GitHubConfig,
  correlationId: string,
  maxWaitMs = 3 * 60 * 1000 // 3 minutes
): Promise<WorkflowRun | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs?event=repository_dispatch&per_page=10`;
  const startTime = Date.now();
  const dispatchTime = Date.now();

  console.log('[findRunByCorrelation] Looking for correlation ID:', correlationId);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        console.warn('[findRunByCorrelation] List runs failed:', response.status);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const data = await response.json();
      const runs = data.workflow_runs || [];
      
      console.log('[findRunByCorrelation] Found', runs.length, 'recent runs');

      // First try to find by correlation ID in run name
      let run = runs.find((r: any) =>
        typeof r.name === 'string' && r.name.includes(correlationId)
      );

      // Fallback: find most recent run created after dispatch
      if (!run && runs.length > 0) {
        run = runs.find((r: any) => {
          const runCreated = new Date(r.created_at).getTime();
          return runCreated >= dispatchTime - 5000; // 5 second grace period
        });
        
        if (run) {
          console.log('[findRunByCorrelation] Found recent run (fallback):', run.id);
        }
      }

      if (run) {
        console.log('[findRunByCorrelation] Found workflow run:', run.id, 'status:', run.status);
        return run as WorkflowRun;
      }

      // Wait 5 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('[findRunByCorrelation] Network error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.error('[findRunByCorrelation] Timeout - no workflow run found');
  return null;
}

/**
 * Fetch workflow job logs for a specific run
 */
async function getWorkflowJobLogs(
  config: GitHubConfig,
  runId: number
): Promise<string> {
  // First, get the list of jobs for this run
  const jobsUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${runId}/jobs`;
  
  const jobsResponse = await fetch(jobsUrl, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!jobsResponse.ok) {
    console.error('[getWorkflowJobLogs] Failed to fetch jobs:', jobsResponse.status);
    return '';
  }

  const { jobs } = await jobsResponse.json();
  
  if (!jobs || jobs.length === 0) {
    return '';
  }

  // Get logs for the first job (usually there's only one)
  const job = jobs[0];
  const logsUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/jobs/${job.id}/logs`;
  
  const logsResponse = await fetch(logsUrl, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!logsResponse.ok) {
    console.error('[getWorkflowJobLogs] Failed to fetch logs:', logsResponse.status);
    return '';
  }

  return await logsResponse.text();
}

/**
 * Parse workflow logs to detect specific error patterns
 */
async function parseWorkflowError(logs: string, runUrl: string, accountEmail?: string): Promise<string> {
  // Check for expired/revoked Google Drive token
  if ((logs.includes('invalid_grant') || logs.includes('Token exchange failed')) && 
      (logs.includes('expired') || logs.includes('revoked') || logs.includes('Token has been'))) {
    
    // Try to fetch the current refresh token from storage
    let tokenInfo = '';
    if (accountEmail) {
      try {
        const result = await new Promise<any>((resolve) => {
          chrome.storage.local.get(['driveAccounts'], resolve);
        });
        
        const account = result.driveAccounts?.find((a: any) => a.email === accountEmail);
        const refreshToken = account?.tokens?.refresh_token;
        
        if (refreshToken) {
          tokenInfo = `\n4. Copy the new token: "${refreshToken}"`;
        } else {
          tokenInfo = '\n4. Copy the new refresh token from GitHub Actions setup';
        }
      } catch (error) {
        console.error('[parseWorkflowError] Failed to fetch token:', error);
        tokenInfo = '\n4. Copy the new refresh token from GitHub Actions setup';
      }
    } else {
      tokenInfo = '\n4. Copy the new refresh token from GitHub Actions setup';
    }
    
    return `🔑 Authentication Failed: Your Google Drive refresh token has expired or been revoked.

To fix this issue:
1. Open the extension popup
2. Go to Account Manager (gear icon)
3. Remove and re-add your Google Drive account${tokenInfo}
5. Update the GitHub repository secret with the new token
6. Retry the upload

Common causes:
• Google password was changed
• Access was revoked manually
• Token hasn't been used for 6+ months

DEBUG: Check your stored tokens by running this in the browser console (F12):
chrome.storage.local.get(['driveAccounts'], (result) => {
  console.log('All accounts:', result.driveAccounts);
  const account = result.driveAccounts.find(a => a.email === '${accountEmail || 'YOUR_EMAIL@gmail.com'}');
  console.log('Account found:', account);
  console.log('Tokens object:', account?.tokens);
  console.log('All token keys:', account?.tokens ? Object.keys(account.tokens) : 'No tokens');
});

View detailed logs: ${runUrl}`;
  }

  // Check for missing credentials
  if (logs.includes('REFRESH_TOKEN') && logs.includes('not found')) {
    return `🔑 Configuration Error: Missing refresh token in GitHub Secrets.

Please ensure the required GitHub Secret is properly configured in your repository.

View detailed logs: ${runUrl}`;
  }

  // Check for quota exceeded
  if (logs.includes('quotaExceeded') || logs.includes('User rate limit exceeded')) {
    return `⚠️ Upload Failed: Google Drive quota or rate limit exceeded.

Please try again later or check your Drive storage quota.

View detailed logs: ${runUrl}`;
  }

  // Check for network/download errors
  if (logs.includes('ENOTFOUND') || logs.includes('ECONNREFUSED') || logs.includes('Failed to fetch')) {
    return `🌐 Network Error: Unable to download the source file.

The file URL may be invalid or temporarily unavailable.

View detailed logs: ${runUrl}`;
  }

  // Generic error with link to logs
  return `❌ Upload failed: Workflow encountered an error. Check logs at: ${runUrl}`;
}

/**
 * Wait for workflow run to complete with detailed error messages
 */
export async function waitForRunCompletion(
  config: GitHubConfig,
  runId: number,
  maxWaitMs = 10 * 60 * 1000, // 10 minutes
  onProgress?: (message: string) => void,
  accountEmail?: string
): Promise<WorkflowRun> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${runId}`;
  const startTime = Date.now();
  let lastStatus = '';

  console.log('[waitForRunCompletion] Waiting for run:', runId);

  let pollCount = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        console.warn('[waitForRunCompletion] Get run status failed:', response.status);
        if (response.status === 404) {
          throw new Error('Workflow run not found. It may have been deleted.');
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const run: WorkflowRun = await response.json();
      pollCount++;

      // Log status changes and send progress updates
      if (run.status !== lastStatus) {
        lastStatus = run.status;
        console.log('[waitForRunCompletion] Status:', run.status, 'Conclusion:', run.conclusion);
        
        if (run.status === 'in_progress') {
          onProgress?.('Workflow running: uploading file to Google Drive...');
        } else if (run.status === 'queued') {
          onProgress?.('Workflow queued: waiting for runner...');
        }
      } else if (run.status === 'in_progress') {
        // Send progress update every poll during upload
        onProgress?.('Uploading to Google Drive...');
      }

      if (run.status === 'completed') {
        console.log('[waitForRunCompletion] Completed with conclusion:', run.conclusion);
        
        if (run.conclusion === 'success') {
          onProgress?.('Upload completed successfully! ✓');
          return run;
        } else if (run.conclusion === 'failure') {
          // Fetch and parse logs for detailed error message
          console.log('[waitForRunCompletion] Fetching logs for failed run...');
          try {
            const logs = await getWorkflowJobLogs(config, runId);
            const errorMessage = await parseWorkflowError(logs, run.html_url, accountEmail);
            throw new Error(errorMessage);
          } catch (logError) {
            // If log fetching fails, fall back to generic error
            if (logError instanceof Error && (
              logError.message.includes('Authentication Failed') ||
              logError.message.includes('Configuration Error') ||
              logError.message.includes('Network Error') ||
              logError.message.includes('quota')
            )) {
              throw logError; // Re-throw our parsed error
            }
            console.error('[waitForRunCompletion] Failed to fetch logs:', logError);
            throw new Error('Upload failed: Workflow encountered an error. Check logs at: ' + run.html_url);
          }
        } else if (run.conclusion === 'cancelled') {
          throw new Error('Upload cancelled: Workflow was manually cancelled.');
        } else if (run.conclusion === 'timed_out') {
          throw new Error('Upload failed: Workflow timed out. File may be too large.');
        } else {
          throw new Error(`Upload failed: Workflow ${run.conclusion}. View logs: ${run.html_url}`);
        }
      }

      // Wait 5 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error: any) {
      // Network errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('[waitForRunCompletion] Network error:', error);
        throw new Error('Network error: Unable to connect to GitHub. Check your internet connection.');
      }
      // Re-throw our custom errors
      throw error;
    }
  }

  console.error('[waitForRunCompletion] Timeout after', maxWaitMs / 1000, 'seconds');
  throw new Error('Upload timed out: Workflow took too long to complete (10+ minutes). Check workflow logs.');
}

/**
 * Download and extract result artifact
 */
export async function getRunResult(
  config: GitHubConfig,
  runId: number
): Promise<UploadResult> {
  // List artifacts for this run
  const listUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${runId}/artifacts`;
  
  console.log('[getRunResult] Listing artifacts for run:', runId);
  
  const listResponse = await fetch(listUrl, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!listResponse.ok) {
    throw new Error(`List artifacts failed: ${listResponse.status}`);
  }

  const { artifacts } = await listResponse.json();
  console.log('[getRunResult] Found artifacts:', artifacts?.length || 0);
  
  if (artifacts && artifacts.length > 0) {
    console.log('[getRunResult] Artifact names:', artifacts.map((a: any) => a.name).join(', '));
  }
  
  const resultArtifact = (artifacts || []).find((a: any) => a.name === 'result');

  if (!resultArtifact) {
    throw new Error(`Result artifact not found. Available artifacts: ${artifacts?.map((a: any) => a.name).join(', ') || 'none'}`);
  }
  
  console.log('[getRunResult] Found result artifact:', resultArtifact.name);

  // Download artifact (it's a ZIP file)
  const downloadResponse = await fetch(resultArtifact.archive_download_url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!downloadResponse.ok) {
    throw new Error(`Download artifact failed: ${downloadResponse.status}`);
  }

  const blob = await downloadResponse.blob();
  const zipBuffer = await blob.arrayBuffer();

  // Unzip to get result.json
  const result = await extractResultFromZip(zipBuffer);
  return result;
}

/**
 * Extract result.json from artifact ZIP
 * Requires JSZip library
 */
async function extractResultFromZip(zipBuffer: ArrayBuffer): Promise<UploadResult> {
  // Check if JSZip is available
  const JSZip = (globalThis as any).JSZip;
  
  if (!JSZip) {
    throw new Error('JSZip library not loaded. Add it to your extension dependencies.');
  }

  const zip = await JSZip.loadAsync(zipBuffer);
  const resultFile = zip.file('result.json');

  if (!resultFile) {
    throw new Error('result.json not found in artifact ZIP');
  }

  const text = await resultFile.async('text');
  return JSON.parse(text);
}

/**
 * Get file size from URL without downloading
 */
async function getFileSizeFromUrl(url: string): Promise<number | undefined> {
  try {
    console.log('[getFileSizeFromUrl] Checking size for:', url);
    
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow'
    });
    
    if (!response.ok) {
      console.warn('[getFileSizeFromUrl] HEAD request failed, trying GET with range');
      // Fallback: Try GET with Range header
      const rangeResponse = await fetch(url, {
        headers: { 'Range': 'bytes=0-0' }
      });
      
      const contentRange = rangeResponse.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          const size = parseInt(match[1]);
          console.log('[getFileSizeFromUrl] Got size from range:', size);
          return size;
        }
      }
    }
    
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength);
      console.log('[getFileSizeFromUrl] Got size from content-length:', size);
      return size;
    }
    
    console.warn('[getFileSizeFromUrl] No size information available');
    return undefined;
  } catch (error) {
    console.error('[getFileSizeFromUrl] Error:', error);
    return undefined;
  }
}

/**
 * Complete workflow: dispatch, wait, get result
 */
export async function uploadViaGitHubActions(
  config: GitHubConfig,
  payload: {
    url: string;
    filename?: string;
    accountKey?: string;
    parentKey?: string;
    parentFolderId?: string;
    accountEmail?: string;
  },
  onProgress?: (percent: number, message: string) => void
): Promise<UploadResult> {
  const correlationId = crypto.randomUUID();
  
  try {
    // Detect file size first
    onProgress?.(2, '📏 Detecting file size...');
    const fileSize = await getFileSizeFromUrl(payload.url);
    
    if (fileSize) {
      const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      console.log('[uploadViaGitHubActions] File size:', fileSize, 'bytes (', sizeMB, 'MB)');
      onProgress?.(5, `📤 Uploading ${sizeMB} MB...`);
    } else {
      onProgress?.(5, '📤 Triggering GitHub Actions workflow...');
    }

    // Prepare payload for dispatch
    const dispatchPayload = {
      url: payload.url,
      filename: payload.filename,
      accountKey: payload.accountKey || config.defaultAccountKey,
      parentKey: payload.parentKey || config.defaultParentKey,
      parentFolderId: payload.parentFolderId,
      correlationId
    };

    // Debug logging
    console.log('=== DEBUG: GitHub Actions Dispatch ===');
    console.log('Extension sending to GitHub:');
    console.log('  URL:', dispatchPayload.url);
    console.log('  Filename:', dispatchPayload.filename);
    console.log('  Parent Folder ID:', dispatchPayload.parentFolderId);
    console.log('  Account Key:', dispatchPayload.accountKey);
    console.log('  Parent Key:', dispatchPayload.parentKey);
    console.log('  Correlation ID:', dispatchPayload.correlationId);
    console.log('Full payload:', JSON.stringify(dispatchPayload, null, 2));
    console.log('=====================================');

    // Dispatch workflow
    await dispatchRemoteUpload(config, dispatchPayload);

    onProgress?.(10, '⏳ Waiting for workflow to start...');

    // Find the run
    const run = await findRunByCorrelation(config, correlationId);
    if (!run) {
      throw new Error('Workflow not found: GitHub Actions workflow did not start within 3 minutes. Check repository settings.');
    }

    onProgress?.(20, '☁️ Uploading file to Google Drive...');

    // Wait for completion with progress updates
    const uploadStartTime = Date.now();
    await waitForRunCompletion(config, run.id, 10 * 60 * 1000, (msg) => {
      // Calculate progress based on time elapsed (estimated)
      const elapsed = Date.now() - uploadStartTime;
      const estimatedDuration = 3 * 60 * 1000; // Estimate 3 minutes for upload
      const timeProgress = Math.min((elapsed / estimatedDuration) * 70, 70); // 20-90%
      const currentProgress = Math.round(20 + timeProgress);
      
      onProgress?.(currentProgress, msg);
    }, payload.accountEmail);

    onProgress?.(90, '📊 Fetching upload result...');

    // Try to get result artifact with retries (artifacts may take a moment to be available)
    let lastError: Error | null = null;
    const maxRetries = 5;
    const retryDelay = 3000; // 3 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[uploadViaGitHubActions] Attempting to fetch artifact (${attempt}/${maxRetries})...`);
        const result = await getRunResult(config, run.id);
        
        // Validate that we got a real file ID
        if (!result.fileId || result.fileId === 'unknown' || result.fileId.length < 10) {
          throw new Error('Invalid file ID received from GitHub Actions workflow');
        }
        
        onProgress?.(100, '✅ Upload completed successfully!');
        console.log('[uploadViaGitHubActions] Successfully retrieved file ID:', result.fileId);
        return result;
      } catch (error: any) {
        lastError = error;
        console.warn(`[uploadViaGitHubActions] Attempt ${attempt} failed:`, error.message);
        
        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          console.log(`[uploadViaGitHubActions] Waiting ${retryDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    // All retries failed
    console.error('[uploadViaGitHubActions] Failed to retrieve artifact after', maxRetries, 'attempts');
    console.error('[uploadViaGitHubActions] Last error:', lastError?.message);
    
    // Throw a user-friendly error
    throw new Error(
      '❌ Upload may have succeeded, but could not retrieve file information. ' +
      'Please check your GitHub Actions workflow logs and ensure the artifact is being created correctly. ' +
      'The workflow should create an artifact named "result" containing result.json with the file ID.'
    );
  } catch (error: any) {
    console.error('[uploadViaGitHubActions] Error:', error);
    
    // Enhance error messages
    let errorMessage = error.message || 'Unknown error occurred';
    
    if (errorMessage.includes('fetch failed') || errorMessage.includes('Network')) {
      errorMessage = '🌐 Network Error: Unable to connect. Check your internet connection and try again.';
    } else if (errorMessage.includes('403')) {
      errorMessage = '🔐 Permission Error: GitHub token lacks required permissions.';
    } else if (errorMessage.includes('404')) {
      errorMessage = '❌ Not Found: Repository or workflow not found.';
    } else if (errorMessage.includes('timed out') || errorMessage.includes('Timeout')) {
      errorMessage = '⏱️ Timeout: Upload took too long. File may be too large or network is slow.';
    } else if (!errorMessage.startsWith('🔐') && !errorMessage.startsWith('❌') && !errorMessage.startsWith('⏱️') && !errorMessage.startsWith('🌐')) {
      // Add emoji prefix for better visibility
      errorMessage = '❌ ' + errorMessage;
    }
    
    throw new Error(errorMessage);
  }
}
