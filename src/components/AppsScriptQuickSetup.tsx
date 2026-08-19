import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  TextField,
  Typography,
  Box,
  Alert,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  IconButton,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface AppsScriptQuickSetupProps {
  open: boolean;
  accountEmail: string;
  onClose: () => void;
  onSave: (config: { webAppUrl: string }) => Promise<void>;
}

export default function AppsScriptQuickSetup({ open, accountEmail, onClose, onSave }: AppsScriptQuickSetupProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [webAppUrl, setWebAppUrl] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load saved draft state when dialog opens
  useEffect(() => {
    if (open && accountEmail && !isLoaded) {
      loadDraftState();
    } else if (!open && isLoaded) {
      // Reset loaded flag when dialog closes
      setIsLoaded(false);
    }
  }, [open, accountEmail, isLoaded]);

  const loadDraftState = async () => {
    try {
      const result = await chrome.storage.local.get(['appsScriptSetupDrafts']);
      if (result.appsScriptSetupDrafts?.[accountEmail]) {
        const draft = result.appsScriptSetupDrafts[accountEmail];
        setWebAppUrl(draft.webAppUrl || '');
        setActiveStep(draft.activeStep || 0);
        console.log('[Apps Script Quick Setup] Loaded draft for:', accountEmail);
      }
      setIsLoaded(true);
    } catch (err) {
      console.error('[Apps Script Quick Setup] Failed to load draft:', err);
      setIsLoaded(true);
    }
  };

  // Save draft state as user types
  const saveDraftState = async () => {
    if (!accountEmail) return;
    
    try {
      const result = await chrome.storage.local.get(['appsScriptSetupDrafts']);
      const drafts = result.appsScriptSetupDrafts || {};
      
      drafts[accountEmail] = {
        webAppUrl,
        activeStep,
        timestamp: Date.now()
      };
      
      await chrome.storage.local.set({ appsScriptSetupDrafts: drafts });
    } catch (err) {
      console.error('[Apps Script Quick Setup] Failed to save draft:', err);
    }
  };

  // Clear draft state for this account
  const clearDraftState = async () => {
    if (!accountEmail) return;
    
    try {
      const result = await chrome.storage.local.get(['appsScriptSetupDrafts']);
      const drafts = result.appsScriptSetupDrafts || {};
      delete drafts[accountEmail];
      await chrome.storage.local.set({ appsScriptSetupDrafts: drafts });
      console.log('[Apps Script Quick Setup] Cleared draft for:', accountEmail);
    } catch (err) {
      console.error('[Apps Script Quick Setup] Failed to clear draft:', err);
    }
  };

  // Save draft whenever inputs change (for auto-save during editing)
  useEffect(() => {
    if (isLoaded && open) {
      saveDraftState();
    }
  }, [webAppUrl, activeStep, isLoaded, open]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleFinish = async () => {
    // First clear the draft to prevent auto-resume
    await clearDraftState();
    // Then save the configuration
    await onSave({ webAppUrl });
    // Finally reset and close
    handleReset();
  };

  const handleCancel = async () => {
    // Clear draft state when user explicitly cancels
    await clearDraftState();
    setIsLoaded(false);
    onClose();
  };

  const handleReset = () => {
    setActiveStep(0);
    setWebAppUrl('');
    setIsLoaded(false);
    onClose();
  };

  const isStepValid = (step: number) => {
    switch (step) {
      case 0:
        return true; // Create project step (informational only)
      case 1:
        return true; // Add code step (informational only)
      case 2:
        return true; // Deploy step (informational only)
      case 3:
        return webAppUrl.trim().startsWith('https://script.google.com/');
      case 4:
        // Final review step - URL must be valid
        return webAppUrl.trim().startsWith('https://script.google.com/');
      default:
        return false;
    }
  };

  const scriptCode = `// Google Apps Script: Code.gs

/**
 * Handles POST requests to upload a file from a URL to Google Drive.
 * @param {object} e - The event parameter containing the POST request data.
 * @returns {ContentService.TextOutput} - A JSON response with the new file's details or an error.
 */
function doPost(e) {
  let response;
  try {
    // 1. Parse the incoming JSON payload from the extension
    const body = JSON.parse(e.postData.contents);
    const { url, filename, parentFolderId } = body;

    if (!url || !filename) {
      throw new Error("Missing required parameters: url and filename.");
    }

    // 2. Fetch the file from the remote URL
    // Note: This has a ~50MB size limit and a 6-minute execution limit.
    const fileBlob = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    }).getBlob();

    // Set the blob's name to the desired filename
    fileBlob.setName(filename);

    // 3. Find the parent folder, or use the root directory if not specified
    let parentFolder;
    if (parentFolderId) {
      try {
        parentFolder = DriveApp.getFolderById(parentFolderId);
      } catch (err) {
        console.warn(\`Could not find folder with ID: \${parentFolderId}. Uploading to root.\`);
        parentFolder = DriveApp.getRootFolder();
      }
    } else {
      parentFolder = DriveApp.getRootFolder();
    }

    // 4. Create the file in the designated folder
    const newFile = parentFolder.createFile(fileBlob);

    // 5. Prepare a success response
    response = {
      status: "success",
      file: {
        id: newFile.getId(),
        name: newFile.getName(),
        webViewLink: newFile.getUrl(),
      },
    };
    
  } catch (error) {
    console.error(error);
    response = {
      status: "error",
      message: error.message,
      stack: error.stack,
    };
  }

  // 6. Return the response as JSON
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  const steps = [
    {
      label: 'Create Apps Script Project',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Create a new Google Apps Script project to host your remote upload backend.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Important:</strong> Make sure you're signed into the Google account: <strong>{accountEmail}</strong>
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>📝 Steps to create project:</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Go to Apps Script"
                  secondary={
                    <>
                      Visit{' '}
                      <Link href="https://script.google.com/create" target="_blank" rel="noopener">
                        script.google.com/create
                      </Link>
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Rename the project (optional)"
                  secondary="Click 'Untitled project' at the top → Name it 'Drive Upload Backend'"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. You'll see an empty Code.gs file"
                  secondary="Ready for the next step!"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              href="https://script.google.com/create"
              target="_blank"
              sx={{ mt: 1 }}
            >
              Create New Project
            </Button>
          </Paper>
        </Box>
      ),
    },
    {
      label: 'Add Upload Script',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Replace the contents of <code>Code.gs</code> with this upload handler script.
          </Typography>

          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Important:</strong> Copy the ENTIRE script below and paste it into your Code.gs file, replacing all existing content.
            </Typography>
          </Alert>

          <Paper 
            variant="outlined" 
            sx={{ 
              p: 2, 
              bgcolor: 'action.hover', 
              fontFamily: 'monospace', 
              fontSize: '0.75rem', 
              whiteSpace: 'pre-wrap',
              maxHeight: '300px',
              overflowY: 'auto'
            }}
          >
            {scriptCode}
          </Paper>
          
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={() => handleCopy(scriptCode, 'Script code')}
            sx={{ mt: 1 }}
          >
            {copied === 'Script code' ? '✓ Copied!' : 'Copy Script'}
          </Button>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>What this script does:</strong> It receives a POST request with a file URL, downloads the file, and saves it to your Google Drive. Best for files under 50MB.
            </Typography>
          </Alert>
        </Box>
      ),
    },
    {
      label: 'Deploy as Web App',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Deploy your script as a web app to make it accessible via a URL.
          </Typography>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>🚀 Deployment steps:</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Click 'Deploy' button"
                  secondary="Top right corner of the Apps Script editor → Click the Deploy button (looks like a paper airplane or ship)"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Select 'New deployment'"
                  secondary="From the dropdown menu"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. Click gear icon (⚙️)"
                  secondary="Next to 'Select type' → Choose 'Web app'"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary={
                    <Box>
                      <Typography component="span" color="text.primary">4. Configure deployment</Typography>
                    </Box>
                  }
                  secondary={
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                      • <strong>Description:</strong> "Drive Upload Backend"
                      <br />• <strong>Execute as:</strong> "Me ({accountEmail})"
                      <br />• <strong>Who has access:</strong> "Anyone"
                    </Box>
                  }
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="5. Click 'Deploy'"
                  secondary="Authorize the script when prompted (click 'Authorize access')"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="6. Authorization process"
                  secondary={
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                      If you see "Google hasn't verified this app":
                      <br />• Click "Advanced" → "Go to [project name] (unsafe)"
                      <br />• Review permissions → Click "Allow"
                      <br />• This is normal for personal scripts
                    </Box>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
          </Paper>

          <Alert severity="success" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>After deployment:</strong> You'll see a Web app URL. Copy it in the next step!
            </Typography>
          </Alert>
        </Box>
      ),
    },
    {
      label: 'Copy Web App URL',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Copy the Web App URL from your deployment and paste it below.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Where to find the URL:</strong> After deploying, you'll see a dialog with "Web app" section. Copy the URL that looks like: <code>https://script.google.com/macros/s/.../exec</code>
            </Typography>
          </Alert>

          <TextField
            fullWidth
            label="Web App URL"
            value={webAppUrl}
            onChange={(e) => setWebAppUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            helperText="Paste the complete Web App URL here"
            error={webAppUrl.trim() !== '' && !webAppUrl.trim().startsWith('https://script.google.com/')}
            sx={{ mb: 2 }}
          />

          <Alert severity="warning">
            <Typography variant="body2">
              <strong>Troubleshooting:</strong> If you closed the dialog, go to Deploy → Manage deployments → Click on your deployment → You'll see the Web app URL
            </Typography>
          </Alert>
        </Box>
      ),
    },
    {
      label: 'Review & Save',
      content: (
        <Box>
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Perfect!</strong> Your Google Apps Script backend is ready. Click Finish to save.
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Configuration Summary
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Account:
                </Typography>
                <Typography variant="body2">{accountEmail}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Web App URL:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {webAppUrl || '(Not set)'}
                </Typography>
              </Box>
            </Box>
          </Paper>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>File size limits:</strong> This backend works best for files under 50MB due to Apps Script execution limits (6 minutes max).
            </Typography>
          </Alert>

          <Alert severity="success">
            <Typography variant="body2">
              <strong>Next:</strong> After saving, enable "Google Apps Script" in the configuration dialog and try uploading from a URL!
            </Typography>
          </Alert>
        </Box>
      ),
    },
  ];

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle>
        Google Apps Script Quick Setup
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
          Configure Google Apps Script for <strong>{accountEmail}</strong>
        </Typography>

        <Stepper activeStep={activeStep} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={step.label}>
              <StepLabel>{step.label}</StepLabel>
              <StepContent>
                {step.content}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="contained"
                    onClick={index === steps.length - 1 ? handleFinish : handleNext}
                    disabled={!isStepValid(index)}
                    sx={{ mr: 1 }}
                  >
                    {index === steps.length - 1 ? 'Finish' : 'Continue'}
                  </Button>
                  <Button disabled={index === 0} onClick={handleBack}>
                    Back
                  </Button>
                </Box>
              </StepContent>
            </Step>
          ))}
        </Stepper>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel} color="inherit">
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
