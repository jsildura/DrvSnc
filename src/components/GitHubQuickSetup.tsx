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
  Chip,
  Paper,
  IconButton,
  InputAdornment,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

interface GitHubQuickSetupProps {
  open: boolean;
  accountEmail: string;
  onClose: () => void;
  onSave: (config: { owner: string; repo: string; token: string }) => void;
}

export default function GitHubQuickSetup({ open, accountEmail, onClose, onSave }: GitHubQuickSetupProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [showClientId, setShowClientId] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER.apps.googleusercontent.com';
  const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET_PLACEHOLDER';

  // Load saved draft state when dialog opens
  useEffect(() => {
    if (open && accountEmail && !isLoaded) {
      loadDraftState();
    }
  }, [open, accountEmail]);

  const loadDraftState = async () => {
    try {
      const result = await chrome.storage.local.get(['quickSetupDrafts']);
      if (result.quickSetupDrafts?.[accountEmail]) {
        const draft = result.quickSetupDrafts[accountEmail];
        setGithubOwner(draft.githubOwner || '');
        setGithubRepo(draft.githubRepo || '');
        setGithubToken(draft.githubToken || '');
        setActiveStep(draft.activeStep || 0);
        console.log('[Quick Setup] Loaded draft for:', accountEmail);
      }
      setIsLoaded(true);
    } catch (err) {
      console.error('[Quick Setup] Failed to load draft:', err);
      setIsLoaded(true);
    }
  };

  // Save draft state as user types
  const saveDraftState = async () => {
    if (!accountEmail) return;
    
    try {
      const result = await chrome.storage.local.get(['quickSetupDrafts']);
      const drafts = result.quickSetupDrafts || {};
      
      drafts[accountEmail] = {
        githubOwner,
        githubRepo,
        githubToken,
        activeStep,
        timestamp: Date.now()
      };
      
      await chrome.storage.local.set({ quickSetupDrafts: drafts });
    } catch (err) {
      console.error('[Quick Setup] Failed to save draft:', err);
    }
  };

  // Clear draft state for this account
  const clearDraftState = async () => {
    if (!accountEmail) return;
    
    try {
      const result = await chrome.storage.local.get(['quickSetupDrafts']);
      const drafts = result.quickSetupDrafts || {};
      delete drafts[accountEmail];
      await chrome.storage.local.set({ quickSetupDrafts: drafts });
      console.log('[Quick Setup] Cleared draft for:', accountEmail);
    } catch (err) {
      console.error('[Quick Setup] Failed to clear draft:', err);
    }
  };

  // Save draft whenever inputs change
  useEffect(() => {
    if (isLoaded && open) {
      saveDraftState();
    }
  }, [githubOwner, githubRepo, githubToken, activeStep, isLoaded, open]);

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
    onSave({ owner: githubOwner, repo: githubRepo, token: githubToken });
    await clearDraftState();
    handleReset();
  };

  const handleCancel = () => {
    // Don't clear draft state on cancel - keep it for next time
    setIsLoaded(false);
    onClose();
  };

  const handleReset = () => {
    setActiveStep(0);
    setGithubOwner('');
    setGithubRepo('');
    setGithubToken('');
    setIsLoaded(false);
    onClose();
  };

  const isStepValid = (step: number) => {
    switch (step) {
      case 0:
        return githubOwner.trim() !== '';
      case 1:
        return githubRepo.trim() !== '';
      case 2:
        return githubToken.trim() !== '';
      case 3:
        return true; // Google credentials step (informational only)
      case 4:
        return true; // Review & Save step (all required fields already validated)
      default:
        return false;
    }
  };

  const steps = [
    {
      label: 'GitHub Username',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Enter your GitHub username or organization name. This is the account that will host the workflow repository.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Where to find:</strong> Visit{' '}
              <Link href="https://github.com" target="_blank" rel="noopener">
                github.com
              </Link>
              {' '}→ Click your profile picture (top right) → Your username is displayed
            </Typography>
          </Alert>

          <TextField
            fullWidth
            label="GitHub Owner/Username"
            value={githubOwner}
            onChange={(e) => setGithubOwner(e.target.value)}
            placeholder="your-username"
            helperText="Example: john-doe or my-organization"
          />
        </Box>
      ),
    },
    {
      label: 'Repository Name',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Choose a name for your workflow repository. This can be a new or existing repository.
          </Typography>

          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Important:</strong> Each Google Drive account should use a <strong>different</strong> repository or have different secrets configured.
            </Typography>
          </Alert>

          <TextField
            fullWidth
            label="Repository Name"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="drive-uploader-actions"
            helperText="Suggested: drive-uploader-actions-1, drive-uploader-actions-2, etc."
            sx={{ mb: 2 }}
          />

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>📝 Option 1: Clone from Template (Recommended)</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Create empty repository"
                  secondary={
                    <>
                      Go to{' '}
                      <Link href="https://github.com/new" target="_blank" rel="noopener">
                        github.com/new
                      </Link>
                      {' '}→ Name: {githubRepo || 'drv-upldr-actns'} → Create
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Clone template repository"
                  secondary={
                    <Box component="div" sx={{ mt: 1 }}>
                      <Paper variant="outlined" sx={{ p: 1, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                        {`# Open Command Prompt or Terminal\ncd C:\\Temp\ngit clone https://github.com/jsildura/drv-upldr-actns.git .\ngit remote set-url origin https://github.com/` + (githubOwner || 'YOUR_USERNAME') + `/` + (githubRepo || 'drv-upldr-actns') + `.git\ngit push -u origin main --force`}
                      </Paper>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => handleCopy(`cd C:\\Temp\ngit clone https://github.com/jsildura/drv-upldr-actns.git .\ngit remote set-url origin https://github.com/` + (githubOwner || 'YOUR_USERNAME') + `/` + (githubRepo || 'drv-upldr-actns') + `.git\ngit push -u origin main --force`, 'Git commands')}
                        sx={{ mt: 1 }}
                      >
                        Copy Commands
                      </Button>
                    </Box>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>📝 Option 2: Manual Setup</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Create repository with README"
                  secondary={
                    <>
                      <Link href="https://github.com/new" target="_blank" rel="noopener">
                        github.com/new
                      </Link>
                      {' '}→ Check "Add a README file"
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Copy workflow files from template"
                  secondary={
                    <>
                      Visit{' '}
                      <Link href="https://github.com/jsildura/drv-upldr-actns" target="_blank" rel="noopener">
                        drv-upldr-actns
                      </Link>
                      {' '}→ Copy .github/workflows/remote-upload.yml and scripts/upload.js
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. Create same structure in your repo"
                  secondary="Add files: .github/workflows/remote-upload.yml, scripts/upload.js, package.json"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              href="https://github.com/jsildura/drv-upldr-actns"
              target="_blank"
              sx={{ mt: 1 }}
            >
              View Template Repository
            </Button>
          </Paper>
        </Box>
      ),
    },
    {
      label: 'Personal Access Token',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Create a Personal Access Token (Classic) with the required permissions to trigger GitHub Actions.
          </Typography>

          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Security:</strong> Never share your token! It provides access to your GitHub account.
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>🔑 How to create a Classic PAT:</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Go to Settings"
                  secondary={
                    <>
                      Visit{' '}
                      <Link href="https://github.com/settings/tokens" target="_blank" rel="noopener">
                        github.com/settings/tokens
                      </Link>
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Generate new token (classic)"
                  secondary="Click 'Generate new token' → Select 'Classic'"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. Token name"
                  secondary={`Example: Drive Uploader - ${accountEmail}`}
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="4. Expiration"
                  secondary="Select: 90 days (or your preference)"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary={
                    <Box>
                      <Typography component="span" color="text.primary">5. Select scopes</Typography>{' '}
                      <Chip label="Required" size="small" color="error" sx={{ ml: 1 }} />
                    </Box>
                  }
                  secondary={
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                      Check <strong>repo</strong> (Full control of private repositories):
                      <br />• repo:status
                      <br />• repo_deployment
                      <br />• public_repo
                      <br />• repo:invite
                      <br />• security_events
                      <br /><br />
                      Check <strong>workflow</strong> (Update GitHub Action workflows)
                    </Box>
                  }
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="6. Generate & Copy"
                  secondary="Save it immediately - you won't see it again!"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              href="https://github.com/settings/tokens/new"
              target="_blank"
              sx={{ mt: 1 }}
            >
              Create Classic Token
            </Button>
          </Paper>

          <TextField
            fullWidth
            label="Personal Access Token"
            type={showToken ? 'text' : 'password'}
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_..."
            helperText="Paste your token here (starts with ghp_)"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowToken(!showToken)}
                    edge="end"
                  >
                    {showToken ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        </Box>
      ),
    },
    {
      label: 'Google Drive Credentials',
      content: (
        <Box>
          <Typography variant="body2" color="text.secondary" paragraph>
            Configure Google Drive API credentials and get your refresh token for GitHub Actions.
          </Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Default credentials provided:</strong> You can use these shared credentials or create your own.
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>📋 Google OAuth Credentials:</strong>
            </Typography>
            
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="GOOGLE_CLIENT_ID"
                value={GOOGLE_CLIENT_ID}
                InputProps={{
                  readOnly: true,
                  type: showClientId ? 'text' : 'password',
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowClientId(!showClientId)} edge="end">
                        {showClientId ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                      <IconButton 
                        onClick={() => handleCopy(GOOGLE_CLIENT_ID, 'Client ID')}
                        edge="end"
                      >
                        <ContentCopyIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 2 }}
                helperText={copied === 'Client ID' ? '✓ Copied!' : 'Copy this for GitHub Secrets'}
              />

              <TextField
                fullWidth
                label="GOOGLE_CLIENT_SECRET"
                value={GOOGLE_CLIENT_SECRET}
                InputProps={{
                  readOnly: true,
                  type: showClientSecret ? 'text' : 'password',
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowClientSecret(!showClientSecret)} edge="end">
                        {showClientSecret ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                      <IconButton 
                        onClick={() => handleCopy(GOOGLE_CLIENT_SECRET, 'Client Secret')}
                        edge="end"
                      >
                        <ContentCopyIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                helperText={copied === 'Client Secret' ? '✓ Copied!' : 'Copy this for GitHub Secrets'}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>🔑 How to get DRIVE_REFRESH_TOKEN_MAIN:</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Authorize in Extension"
                  secondary="Make sure you've already logged into this Google Drive account in the extension"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Open Extension Service Worker Console"
                  secondary={
                    <>
                      Go to chrome://extensions → Find 'Google Drive Uploader' → Click 'service worker' link
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. Run this code in Console"
                  secondary={
                    <Box component="div" sx={{ mt: 1 }}>
                      <Paper variant="outlined" sx={{ p: 1, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                        {`chrome.storage.local.get(['driveAccounts'], (result) => {\n  console.log('All accounts:', result.driveAccounts);\n  const account = result.driveAccounts.find(a => a.email === '` + accountEmail + `');\n  console.log('Account found:', account);\n  console.log('Tokens object:', account?.tokens);\n  console.log('All token keys:', account?.tokens ? Object.keys(account.tokens) : 'No tokens');\n});`}
                      </Paper>
                      <Button
                        size="small"
                        startIcon={<ContentCopyIcon />}
                        onClick={() => handleCopy(`chrome.storage.local.get(['driveAccounts'], (result) => {\n  console.log('All accounts:', result.driveAccounts);\n  const account = result.driveAccounts.find(a => a.email === '` + accountEmail + `');\n  console.log('Account found:', account);\n  console.log('Tokens object:', account?.tokens);\n  console.log('All token keys:', account?.tokens ? Object.keys(account.tokens) : 'No tokens');\n});`, 'Code snippet')}
                        sx={{ mt: 1 }}
                      >
                        Copy Code
                      </Button>
                    </Box>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="4. Find and copy the Refresh Token"
                  secondary={
                    <Box component="span">
                      Look in console output for 'Tokens object' → Find 'refreshToken' property → Copy the value (starts with '1//')
                      <br />
                      <strong>Note:</strong> If 'refreshToken' shows undefined, check other properties like 'refresh_token' or expand the full account object
                    </Box>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
          </Paper>

          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>⚠️ Critical Step:</strong> You must add these credentials as GitHub Secrets in your repository!
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="caption" display="block" gutterBottom color="text.primary">
              <strong>🔐 Add Secrets to GitHub Repository:</strong>
            </Typography>
            <List dense>
              <ListItem disablePadding>
                <ListItemText
                  primary="1. Go to repository settings"
                  secondary={
                    <>
                      Visit: github.com/{githubOwner || 'YOUR_USERNAME'}/{githubRepo || 'your-repo'}/settings/secrets/actions
                    </>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="2. Click 'New repository secret'"
                  secondary="Add each secret one by one"
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
              <ListItem disablePadding>
                <ListItemText
                  primary="3. Add these 3 secrets"
                  secondary={
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                      • <strong>GOOGLE_CLIENT_ID</strong> (copy from above)
                      <br />• <strong>GOOGLE_CLIENT_SECRET</strong> (copy from above)
                      <br />• <strong>DRIVE_REFRESH_TOKEN_MAIN</strong> (from console command above)
                    </Box>
                  }
                  primaryTypographyProps={{ color: 'text.primary' }}
                />
              </ListItem>
            </List>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              href={`https://github.com/${githubOwner || 'YOUR_USERNAME'}/${githubRepo || 'your-repo'}/settings/secrets/actions`}
              target="_blank"
              sx={{ mt: 1 }}
              disabled={!githubOwner || !githubRepo}
            >
              Open Repository Secrets
            </Button>
          </Paper>
        </Box>
      ),
    },
    {
      label: 'Review & Save',
      content: (
        <Box>
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
            <Typography variant="body2">
              <strong>Great!</strong> Review your configuration and click Finish to save.
            </Typography>
          </Alert>

          <Paper variant="outlined" sx={{ p: 2 }}>
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
                  GitHub Owner:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {githubOwner}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Repository:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {githubRepo}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Token:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {githubToken.substring(0, 20)}...
                </Typography>
              </Box>
            </Box>
          </Paper>

          <Alert severity="info" sx={{ mt: 2 }}>
            <Typography variant="body2">
              <strong>Next steps:</strong> Make sure you've set up the GitHub Actions workflow file and repository secrets as per the documentation.
            </Typography>
          </Alert>
        </Box>
      ),
    },
  ];

  return (
    <Dialog open={open} onClose={handleReset} maxWidth="md" fullWidth>
      <DialogTitle>
      GitHub Actions Quick Setup
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 3 }}>
          Configure GitHub Actions for <strong>{accountEmail}</strong>
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
