import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  Switch,
  FormControlLabel,
  Card,
  CardContent,
  InputAdornment,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Link,
  Step,
  Stepper,
  StepLabel,
  StepContent,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { GitHubConfig, GitHubAccount } from '../lib/types';
import { sendMessage } from '../lib/messaging';

export default function GitHubActionsConfig() {
  const [config, setConfig] = useState<GitHubConfig>({
    owner: '',
    repo: '',
    token: '',
    defaultAccountKey: 'DRIVE_REFRESH_TOKEN_MAIN',
    defaultParentKey: 'DRIVE_PARENT_FOLDER_MAIN',
    enabled: false,
  });
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  useEffect(() => {
    loadConfig();
    loadAccounts();
  }, []);

  const loadConfig = async () => {
    try {
      const githubConfig = await sendMessage<GitHubConfig | null>({ type: 'GET_GITHUB_CONFIG' });
      if (githubConfig) {
        setConfig(githubConfig);
      }
    } catch (err: any) {
      setError(`Failed to load configuration: ${err.message}`);
    }
  };

  const loadAccounts = async () => {
    try {
      const githubAccounts = await sendMessage<GitHubAccount[]>({ type: 'GET_GITHUB_ACCOUNTS' });
      setAccounts(githubAccounts || []);
    } catch (err: any) {
      console.error('Failed to load accounts:', err);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate inputs
      if (config.enabled) {
        if (!config.owner.trim()) {
          throw new Error('GitHub username/org is required when enabled');
        }
        if (!config.repo.trim()) {
          throw new Error('Repository name is required when enabled');
        }
        if (!config.token.trim()) {
          throw new Error('GitHub PAT is required when enabled');
        }
      }

      await sendMessage({
        type: 'UPDATE_GITHUB_CONFIG',
        payload: config
      });

      await sendMessage({
        type: 'UPDATE_GITHUB_ACCOUNTS',
        payload: accounts
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addAccount = () => {
    const newAccount: GitHubAccount = {
      id: crypto.randomUUID(),
      name: 'New Account',
      secretKey: 'DRIVE_REFRESH_TOKEN_',
      folderKey: 'DRIVE_PARENT_FOLDER_'
    };
    setAccounts([...accounts, newAccount]);
  };

  const updateAccount = (id: string, updates: Partial<GitHubAccount>) => {
    setAccounts(accounts.map(acc => acc.id === id ? { ...acc, ...updates } : acc));
  };

  const removeAccount = (id: string) => {
    setAccounts(accounts.filter(acc => acc.id !== id));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="h6">GitHub Actions Backend</Typography>
        <Chip label="FREE" color="success" size="small" />
        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto' }}>
          <Button 
            size="small" 
            variant={showSetupWizard ? "contained" : "outlined"}
            onClick={() => setShowSetupWizard(!showSetupWizard)}
          >
            {showSetupWizard ? 'Hide' : 'Setup Guide'}
          </Button>
          <IconButton size="small" onClick={() => setShowHelp(!showHelp)}>
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Collapse in={showHelp}>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            <strong>What is this?</strong>
          </Typography>
          <Typography variant="body2" paragraph>
            GitHub Actions provides **100% free** backend for URL uploads. No credit card, no server deployment!
          </Typography>
          <Typography variant="body2" paragraph>
            <strong>How it works:</strong> Extension triggers your GitHub workflow → Runner downloads URL → 
            Streams to Drive → Returns file ID
          </Typography>
          <Typography variant="body2" paragraph>
            <strong>Free tier:</strong> 2,000 minutes/month for public repos (effectively unlimited for personal use)
          </Typography>
          <Typography variant="body2">
            See <code>github-actions-uploader/README.md</code> for complete setup instructions.
          </Typography>
        </Alert>
      </Collapse>

      {/* Setup Wizard */}
      <Collapse in={showSetupWizard}>
        <Card variant="outlined" sx={{ mb: 2, bgcolor: 'info.50' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom color="primary">
              📚 Complete Setup Guide
            </Typography>
            
            <Stepper orientation="vertical" sx={{ mt: 2 }}>
              {/* Step 1: Deploy Workflow */}
              <Step active expanded>
                <StepLabel>Deploy GitHub Workflow</StepLabel>
                <StepContent>
                  <Typography variant="body2" paragraph>
                    First, deploy the workflow to your GitHub repository.
                  </Typography>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="caption">
                      Clone the workflow from: <code>github-actions-uploader/</code> folder
                    </Typography>
                  </Alert>
                  <Link 
                    href="https://github.com/new" 
                    target="_blank"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}
                  >
                    Create new GitHub repo <OpenInNewIcon fontSize="small" />
                  </Link>
                </StepContent>
              </Step>

              {/* Step 2: Get OAuth Credentials */}
              <Step active expanded>
                <StepLabel>Get Google OAuth Credentials</StepLabel>
                <StepContent>
                  <Typography variant="body2" gutterBottom>
                    Create OAuth 2.0 credentials for authentication:
                  </Typography>
                  <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
                    <li>
                      <Link href="https://console.cloud.google.com/apis/credentials" target="_blank">
                        Open Google Cloud Console <OpenInNewIcon fontSize="inherit" />
                      </Link>
                    </li>
                    <li>Click "+ CREATE CREDENTIALS" → "OAuth client ID"</li>
                    <li>Application type: <strong>Web application</strong></li>
                    <li>Name: <code>Drive Uploader OAuth</code></li>
                    <li>Authorized redirect URIs: Add <code>https://developers.google.com/oauthplayground</code></li>
                    <li>Click "CREATE" and <strong>copy Client ID & Secret</strong></li>
                  </Box>
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <Typography variant="caption">
                      ✅ Save these credentials - you'll use them for all accounts!
                    </Typography>
                  </Alert>
                </StepContent>
              </Step>

              {/* Step 3: Generate Refresh Tokens */}
              <Step active expanded>
                <StepLabel>Generate Refresh Tokens (Per Account)</StepLabel>
                <StepContent>
                  <Typography variant="body2" gutterBottom>
                    For <strong>each Google Drive account</strong> you want to add:
                  </Typography>
                  <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
                    <li>
                      <Link href="https://developers.google.com/oauthplayground/" target="_blank">
                        Open OAuth Playground <OpenInNewIcon fontSize="inherit" />
                      </Link>
                    </li>
                    <li>Click ⚙️ Settings → Check "Use your own OAuth credentials"</li>
                    <li>Enter your <strong>Client ID</strong> and <strong>Client Secret</strong></li>
                    <li>Close settings</li>
                    <li>Step 1: Select <code>https://www.googleapis.com/auth/drive.file</code></li>
                    <li>Click "Authorize APIs"</li>
                    <li><strong>Sign in with the Google account</strong> you want to add</li>
                    <li>Grant permissions</li>
                    <li>Step 2: Click "Exchange authorization code for tokens"</li>
                    <li><strong>Copy the refresh_token</strong> (starts with <code>1//</code>)</li>
                  </Box>
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    <Typography variant="caption">
                      ⚠️ Repeat this process for each account, signing in with different Google accounts each time!
                    </Typography>
                  </Alert>
                </StepContent>
              </Step>

              {/* Step 4: Add GitHub Secrets */}
              <Step active expanded>
                <StepLabel>Add Secrets to GitHub</StepLabel>
                <StepContent>
                  <Typography variant="body2" paragraph>
                    Add these secrets to your GitHub repository:
                  </Typography>
                  
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="body2">Required for all accounts</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box component="ul" sx={{ pl: 2 }}>
                        <li><code>GOOGLE_CLIENT_ID</code> - Your OAuth Client ID</li>
                        <li><code>GOOGLE_CLIENT_SECRET</code> - Your OAuth Client Secret</li>
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="body2">Per-account secrets</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box component="ul" sx={{ pl: 2 }}>
                        <li><code>DRIVE_REFRESH_TOKEN_MAIN</code> - Account 1 refresh token</li>
                        <li><code>DRIVE_REFRESH_TOKEN_ACCOUNT2</code> - Account 2 refresh token</li>
                        <li><code>DRIVE_REFRESH_TOKEN_ACCOUNT3</code> - Account 3 refresh token</li>
                        <li><em>(Add more as needed)</em></li>
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Button 
                    variant="outlined" 
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    sx={{ mt: 2 }}
                    onClick={() => {
                      const repoUrl = config.owner && config.repo 
                        ? `https://github.com/${config.owner}/${config.repo}/settings/secrets/actions`
                        : 'https://github.com';
                      window.open(repoUrl, '_blank');
                    }}
                  >
                    Open GitHub Secrets Settings
                  </Button>
                </StepContent>
              </Step>

              {/* Step 5: Create GitHub PAT */}
              <Step active expanded>
                <StepLabel>Create GitHub Personal Access Token</StepLabel>
                <StepContent>
                  <Typography variant="body2" paragraph>
                    The extension needs a token to trigger workflows:
                  </Typography>
                  <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
                    <li>
                      <Link href="https://github.com/settings/tokens?type=beta" target="_blank">
                        Go to GitHub Tokens <OpenInNewIcon fontSize="inherit" />
                      </Link>
                    </li>
                    <li>Click "Generate new token" → "Fine-grained token"</li>
                    <li>Token name: <code>Drive Uploader Extension</code></li>
                    <li>Expiration: 90 days (or custom)</li>
                    <li>Repository access: Select your workflow repo</li>
                    <li>
                      Permissions:
                      <Box component="ul" sx={{ mt: 0.5 }}>
                        <li>Actions: <strong>Read and write</strong></li>
                        <li>Contents: <strong>Read-only</strong></li>
                      </Box>
                    </li>
                    <li>Click "Generate token"</li>
                    <li><strong>Copy the token immediately</strong> (you can't see it again!)</li>
                  </Box>
                </StepContent>
              </Step>

              {/* Step 6: Configure Extension */}
              <Step active expanded>
                <StepLabel>Configure This Extension</StepLabel>
                <StepContent>
                  <Typography variant="body2" paragraph>
                    Almost done! Now configure the extension below:
                  </Typography>
                  <Box component="ol" sx={{ pl: 2, '& li': { mb: 1 } }}>
                    <li>Enter your <strong>GitHub Username</strong> (e.g., <code>jsildura</code>)</li>
                    <li>Enter your <strong>Repository Name</strong> (e.g., <code>drv-upldr-actns</code>)</li>
                    <li>Paste your <strong>GitHub PAT</strong></li>
                    <li>Default Account Secret Key: <code>DRIVE_REFRESH_TOKEN_MAIN</code></li>
                    <li>Toggle "Enable GitHub Actions Backend"</li>
                    <li>Click "Save Configuration"</li>
                  </Box>
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <Typography variant="caption">
                      🎉 After saving, you can upload URLs and they'll automatically go through GitHub Actions!
                    </Typography>
                  </Alert>
                </StepContent>
              </Step>
            </Stepper>
          </CardContent>
        </Card>
      </Collapse>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Configuration saved successfully!
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom fontWeight="bold">
            Repository Configuration
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
              }
              label="Enable GitHub Actions Backend (for URL uploads)"
            />

            <TextField
              label="GitHub Username/Org"
              placeholder="your-username"
              value={config.owner}
              onChange={(e) => setConfig({ ...config, owner: e.target.value })}
              disabled={!config.enabled}
              fullWidth
              helperText="Your GitHub username or organization name"
            />

            <TextField
              label="Repository Name"
              placeholder="drive-uploader-actions"
              value={config.repo}
              onChange={(e) => setConfig({ ...config, repo: e.target.value })}
              disabled={!config.enabled}
              fullWidth
              helperText="The repo containing the workflow (must be public for free tier)"
            />

            <TextField
              label="GitHub Personal Access Token (Fine-Grained)"
              type={showToken ? 'text' : 'password'}
              value={config.token}
              onChange={(e) => setConfig({ ...config, token: e.target.value })}
              disabled={!config.enabled}
              fullWidth
              helperText="Fine-grained PAT with Actions: R/W, Contents: R"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowToken(!showToken)}
                      edge="end"
                      disabled={!config.enabled}
                    >
                      {showToken ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              label="Default Account Secret Key"
              placeholder="DRIVE_REFRESH_TOKEN_MAIN"
              value={config.defaultAccountKey}
              onChange={(e) => setConfig({ ...config, defaultAccountKey: e.target.value })}
              disabled={!config.enabled}
              fullWidth
              helperText="GitHub secret name for the default Drive account"
            />

            <TextField
              label="Default Folder Secret Key (Optional)"
              placeholder="DRIVE_PARENT_FOLDER_MAIN"
              value={config.defaultParentKey || ''}
              onChange={(e) => setConfig({ ...config, defaultParentKey: e.target.value || undefined })}
              disabled={!config.enabled}
              fullWidth
              helperText="GitHub secret name for the default folder ID"
            />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              Drive Accounts Mapping
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={addAccount}
              disabled={!config.enabled}
            >
              Add Account
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" paragraph>
            Map display names to GitHub secret keys. These secrets must exist in your GitHub repository.
          </Typography>

          {accounts.length === 0 ? (
            <Alert severity="info">
              No accounts configured. Add accounts to enable multi-account uploads.
            </Alert>
          ) : (
            <List>
              {accounts.map((account) => (
                <ListItem key={account.id} sx={{ flexDirection: 'column', alignItems: 'stretch', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                    <TextField
                      label="Display Name"
                      value={account.name}
                      onChange={(e) => updateAccount(account.id, { name: e.target.value })}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Email (Optional)"
                      value={account.email || ''}
                      onChange={(e) => updateAccount(account.id, { email: e.target.value })}
                      size="small"
                      sx={{ flex: 1 }}
                    />
                    <IconButton onClick={() => removeAccount(account.id)} color="error">
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, width: '100%' }}>
                    <TextField
                      label="Secret Key (Refresh Token)"
                      value={account.secretKey}
                      onChange={(e) => updateAccount(account.id, { secretKey: e.target.value })}
                      size="small"
                      placeholder="DRIVE_REFRESH_TOKEN_MAIN"
                      sx={{ flex: 1 }}
                      helperText="GitHub secret containing refresh token"
                    />
                    <TextField
                      label="Folder Key (Optional)"
                      value={account.folderKey || ''}
                      onChange={(e) => updateAccount(account.id, { folderKey: e.target.value })}
                      size="small"
                      placeholder="DRIVE_PARENT_FOLDER_MAIN"
                      sx={{ flex: 1 }}
                      helperText="GitHub secret containing folder ID"
                    />
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Button
        variant="contained"
        startIcon={<SaveIcon />}
        onClick={handleSave}
        disabled={loading}
        fullWidth
      >
        {loading ? 'Saving...' : 'Save Configuration'}
      </Button>

      <Alert severity="warning" sx={{ mt: 2 }}>
        <Typography variant="caption">
          <strong>Security:</strong> GitHub PAT is stored locally in your browser. 
          Ensure it has minimal permissions (repo-scoped, Actions: R/W, Contents: R only).
        </Typography>
      </Alert>

      <Alert severity="info" sx={{ mt: 1 }}>
        <Typography variant="caption">
          <strong>Setup Required:</strong> You must first deploy the workflow to your GitHub repository. 
          See <code>github-actions-uploader/README.md</code> for complete instructions.
        </Typography>
      </Alert>
    </Box>
  );
}
