import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  IconButton,
  Chip,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Avatar,
  Collapse,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import GitHubIcon from '@mui/icons-material/GitHub';
import WebhookIcon from '@mui/icons-material/Webhook';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import type { DriveAccount } from '../lib/types';
import { sendMessage } from '../lib/messaging';
import GitHubQuickSetup from './GitHubQuickSetup';
import AppsScriptQuickSetup from './AppsScriptQuickSetup';

export default function AccountManager() {
  const [accounts, setAccounts] = useState<DriveAccount[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [editDialog, setEditDialog] = useState<DriveAccount | null>(null);
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubSecretKey, setGithubSecretKey] = useState('');
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [quickSetupAccount, setQuickSetupAccount] = useState<DriveAccount | null>(null);
  const [appsScriptDialog, setAppsScriptDialog] = useState<DriveAccount | null>(null);
  const [appsScriptUrl, setAppsScriptUrl] = useState('');
  const [appsScriptEnabled, setAppsScriptEnabled] = useState(false);
  const [appsScriptSizeLimit, setAppsScriptSizeLimit] = useState(50);
  const [appsScriptQuickSetupOpen, setAppsScriptQuickSetupOpen] = useState(false);
  const [appsScriptQuickSetupAccount, setAppsScriptQuickSetupAccount] = useState<DriveAccount | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadAccounts();
    loadCurrentAccount();
    debugSavedConfigs();
  }, []);

  // Debug function to check saved configurations
  const debugSavedConfigs = async () => {
    try {
      const result = await chrome.storage.local.get(['savedGitHubConfigs', 'savedAppsScriptConfigs']);
      console.log('[AccountManager] Saved GitHub configs:', result.savedGitHubConfigs || {});
      console.log('[AccountManager] Saved Apps Script configs:', result.savedAppsScriptConfigs || {});
    } catch (err) {
      console.error('[AccountManager] Failed to debug saved configs:', err);
    }
  };

  // Load setup states after accounts are loaded
  useEffect(() => {
    if (accounts.length > 0) {
      loadQuickSetupState();
      loadAppsScriptSetupState();
    }
  }, [accounts]);

  // Fetch profile pictures for accounts that don't have them
  useEffect(() => {
    if (accounts.length > 0) {
      updateMissingProfilePictures();
    }
  }, [accounts.length]);

  const updateMissingProfilePictures = async () => {
    try {
      const accountsNeedingPictures = accounts.filter(acc => !acc.picture);
      
      if (accountsNeedingPictures.length === 0) return;
      
      console.log('[AccountManager] Fetching profile pictures for', accountsNeedingPictures.length, 'accounts');
      
      let updated = false;
      const updatedAccounts = [...accounts];
      
      for (const account of accountsNeedingPictures) {
        try {
          // Get valid token (this will refresh if expired)
          const response = await sendMessage({
            type: 'GET_VALID_TOKEN',
            payload: { accountId: account.id }
          });
          
          if (!response || !response.access_token) {
            console.warn('[AccountManager] No valid token for account:', account.email);
            continue;
          }
          
          // Fetch user info from Google API with valid token
          const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
              'Authorization': `Bearer ${response.access_token}`
            }
          });
          
          if (userInfoResponse.ok) {
            const userInfo = await userInfoResponse.json();
            if (userInfo.picture) {
              const index = updatedAccounts.findIndex(a => a.id === account.id);
              if (index !== -1) {
                updatedAccounts[index] = {
                  ...updatedAccounts[index],
                  picture: userInfo.picture
                };
                updated = true;
                console.log('[AccountManager] Updated picture for:', account.email);
              }
            }
          } else {
            console.warn('[AccountManager] Failed to fetch userinfo:', userInfoResponse.status, await userInfoResponse.text());
          }
        } catch (err) {
          console.error('[AccountManager] Failed to fetch picture for', account.email, err);
        }
      }
      
      if (updated) {
        await sendMessage({
          type: 'UPDATE_ACCOUNTS',
          payload: updatedAccounts
        });
        await loadAccounts();
      }
    } catch (err) {
      console.error('[AccountManager] Failed to update profile pictures:', err);
    }
  };

  // Load persisted quick setup state (GitHub Actions)
  const loadQuickSetupState = async () => {
    try {
      const result = await chrome.storage.local.get(['quickSetupState']);
      if (result.quickSetupState) {
        const { accountEmail, timestamp } = result.quickSetupState;
        // Only restore if setup was started within last 24 hours
        const age = Date.now() - timestamp;
        if (age < 24 * 60 * 60 * 1000) {
          const account = accounts.find(a => a.email === accountEmail);
          if (account) {
            setQuickSetupAccount(account);
            setQuickSetupOpen(true);
          }
        } else {
          // Clear expired state
          await chrome.storage.local.remove(['quickSetupState']);
        }
      }
    } catch (err) {
      console.error('Failed to load quick setup state:', err);
    }
  };

  // Load persisted Apps Script setup state
  const loadAppsScriptSetupState = async () => {
    try {
      const result = await chrome.storage.local.get(['appsScriptSetupDrafts']);
      if (!result.appsScriptSetupDrafts || accounts.length === 0) {
        console.log('[AccountManager] No Apps Script drafts found or no accounts loaded');
        return;
      }
      
      console.log('[AccountManager] Checking Apps Script drafts:', Object.keys(result.appsScriptSetupDrafts));

      // Find the most recent unfinished setup
      let mostRecentAccount: DriveAccount | null = null;
      let mostRecentTimestamp = 0;
      
      for (const [email, draft] of Object.entries(result.appsScriptSetupDrafts)) {
        const draftData = draft as any;
        // Only consider drafts from the last 24 hours that aren't completed
        const age = Date.now() - draftData.timestamp;
        if (age < 24 * 60 * 60 * 1000 && draftData.timestamp > mostRecentTimestamp) {
          // Check if this account exists and doesn't have Apps Script fully configured
          const account = accounts.find((a) => a.email === email);
          // Only auto-resume if:
          // 1. Account exists
          // 2. Apps Script is NOT fully configured (both enabled AND url must be set to be considered "configured")
          // 3. Draft has actual content (webAppUrl was entered)
          const isConfigured = account?.appsScriptEnabled && account?.appsScriptUrl;
          const hasContent = draftData.webAppUrl && draftData.webAppUrl.trim().length > 0;
          
          if (account && !isConfigured && hasContent) {
            mostRecentAccount = account;
            mostRecentTimestamp = draftData.timestamp;
          } else if (account) {
            console.log(`[AccountManager] Skipping draft for ${email}:`, {
              isConfigured,
              hasContent,
              enabled: account.appsScriptEnabled,
              url: account.appsScriptUrl ? 'present' : 'missing'
            });
          }
        }
      }
      
      // Auto-open the most recent unfinished setup
      if (mostRecentAccount) {
        console.log('[AccountManager] Auto-resuming Apps Script setup for:', mostRecentAccount.email);
        setAppsScriptQuickSetupAccount(mostRecentAccount);
        setAppsScriptQuickSetupOpen(true);
      }
    } catch (err) {
      console.error('Failed to load Apps Script setup state:', err);
    }
  };


  const loadAccounts = async () => {
    try {
      const accountList = await sendMessage<DriveAccount[]>({ type: 'GET_ACCOUNTS' });
      
      // Migration: Fix githubSecretKey for accounts with GitHub Actions enabled
      let needsMigration = false;
      const migratedAccounts = (accountList || []).map((account, index) => {
        if (account.githubEnabled && account.githubOwner && account.githubRepo) {
          const correctKey = 'DRIVE_REFRESH_TOKEN_MAIN';
          
          // If missing or using old pattern (DRIVE_REFRESH_TOKEN_2, etc), fix it
          if (!account.githubSecretKey || account.githubSecretKey !== correctKey) {
            needsMigration = true;
            const oldKey = account.githubSecretKey || '(none)';
            console.log(`[AccountManager] Migrating account ${account.email} - changing githubSecretKey from "${oldKey}" to "${correctKey}"`);
            return {
              ...account,
              githubSecretKey: correctKey
            };
          }
        }
        return account;
      });
      
      // If migration happened, save the updated accounts
      if (needsMigration) {
        console.log('[AccountManager] Saving migrated accounts with githubSecretKey');
        await sendMessage({
          type: 'UPDATE_ACCOUNTS',
          payload: migratedAccounts
        });
        setAccounts(migratedAccounts);
      } else {
        setAccounts(accountList || []);
      }
    } catch (err: any) {
      setError(`Failed to load accounts: ${err.message}`);
    }
  };

  const loadCurrentAccount = async () => {
    try {
      const prefs = await sendMessage<any>({ type: 'GET_PREFS' });
      setCurrentAccountId(prefs?.defaultAccountId);
    } catch (err: any) {
      console.error('Failed to load current account:', err);
    }
  };

  const handleAddAccount = async () => {
    setLoading(true);
    setError(null);

    try {
      const tokens = await sendMessage({ type: 'AUTH_SIGN_IN' });
      const account = await sendMessage<DriveAccount>({ 
        type: 'ADD_ACCOUNT',
        payload: tokens
      });
      
      // Try to restore configurations before loading accounts
      // Combine both restorations into a single update to prevent overwrites
      await restoreAllConfigurationsForAccount(account);
      
      // Load accounts one final time to ensure UI is in sync
      await loadAccounts();
      
      // If this is the first account, make it default
      if (accounts.length === 0) {
        await handleSwitchAccount(account.id);
      }
    } catch (err: any) {
      setError(`Failed to add account: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    try {
      // Find the account to preserve configurations
      const account = accounts.find(a => a.id === accountId);
      
      if (account) {
        console.log('[AccountManager] Removing account:', account.email);
        console.log('[AccountManager] Account has GitHub config:', {
          owner: account.githubOwner,
          repo: account.githubRepo,
          enabled: account.githubEnabled
        });
        console.log('[AccountManager] Account has Apps Script config:', {
          url: account.appsScriptUrl,
          enabled: account.appsScriptEnabled
        });
        
        // Save GitHub Actions config before deletion
        await saveGitHubConfigForFutureRestore(account);
        // Save Apps Script config before deletion
        await saveAppsScriptConfigForFutureRestore(account);
      }
      
      await sendMessage({
        type: 'REMOVE_ACCOUNT',
        payload: { accountId }
      });
      
      await loadAccounts();
      
      // If we removed the current account, clear it
      if (currentAccountId === accountId) {
        setCurrentAccountId(undefined);
      }
      
      setDeleteDialog(null);
    } catch (err: any) {
      setError(`Failed to remove account: ${err.message}`);
    }
  };

  // Save GitHub Actions configuration for future restoration
  const saveGitHubConfigForFutureRestore = async (account: DriveAccount) => {
    // Save if ANY GitHub configuration exists, even if disabled
    if (account.githubOwner || account.githubRepo || account.githubToken || account.githubSecretKey) {
      try {
        const result = await chrome.storage.local.get(['savedGitHubConfigs']);
        const savedConfigs = result.savedGitHubConfigs || {};
        
        savedConfigs[account.email] = {
          githubOwner: account.githubOwner,
          githubRepo: account.githubRepo,
          githubToken: account.githubToken,
          githubSecretKey: account.githubSecretKey,
          githubEnabled: account.githubEnabled,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({ savedGitHubConfigs: savedConfigs });
        console.log('[AccountManager] Saved GitHub config for:', account.email, '(enabled:', account.githubEnabled, ')');
      } catch (err) {
        console.error('[AccountManager] Failed to save GitHub config:', err);
      }
    } else {
      console.log('[AccountManager] No GitHub config to save for:', account.email);
    }
  };

  // Restore all configurations for an account (GitHub Actions + Apps Script) in one update
  const restoreAllConfigurationsForAccount = async (account: DriveAccount) => {
    try {
      const result = await chrome.storage.local.get(['savedGitHubConfigs', 'savedAppsScriptConfigs']);
      const savedGitHubConfigs = result.savedGitHubConfigs || {};
      const savedAppsScriptConfigs = result.savedAppsScriptConfigs || {};
      
      const hasGitHubConfig = !!savedGitHubConfigs[account.email];
      const hasAppsScriptConfig = !!savedAppsScriptConfigs[account.email];
      
      if (!hasGitHubConfig && !hasAppsScriptConfig) {
        console.log('[AccountManager] No saved configurations found for:', account.email);
        return;
      }
      
      console.log('[AccountManager] Restoring configurations for:', account.email);
      if (hasGitHubConfig) {
        console.log('[AccountManager] - Found GitHub Actions config:', savedGitHubConfigs[account.email]);
      }
      if (hasAppsScriptConfig) {
        console.log('[AccountManager] - Found Apps Script config:', savedAppsScriptConfigs[account.email]);
      }
      
      // Get fresh account list from service worker
      const currentAccounts = await sendMessage({ type: 'GET_ACCOUNTS' });
      
      // Build updated account with all restored configurations
      let updatedAccount: DriveAccount = { ...account };
      
      // Apply GitHub Actions config if available
      if (hasGitHubConfig) {
        const githubConfig = savedGitHubConfigs[account.email];
        updatedAccount = {
          ...updatedAccount,
          githubOwner: githubConfig.githubOwner,
          githubRepo: githubConfig.githubRepo,
          githubToken: githubConfig.githubToken,
          githubSecretKey: githubConfig.githubSecretKey,
          githubEnabled: githubConfig.githubEnabled
        };
      }
      
      // Apply Apps Script config if available
      if (hasAppsScriptConfig) {
        const appsScriptConfig = savedAppsScriptConfigs[account.email];
        updatedAccount = {
          ...updatedAccount,
          appsScriptUrl: appsScriptConfig.appsScriptUrl,
          appsScriptEnabled: appsScriptConfig.appsScriptEnabled,
          appsScriptSizeLimit: appsScriptConfig.appsScriptSizeLimit
        };
      }
      
      // Single update with all configurations
      const updatedAccounts = currentAccounts.map((acc: DriveAccount) =>
        acc.id === account.id ? updatedAccount : acc
      );
      
      await sendMessage({
        type: 'UPDATE_ACCOUNTS',
        payload: updatedAccounts
      });
      
      console.log('[AccountManager] ✅ All configurations restored successfully for:', account.email);
      
      // Don't delete saved configs - keep them for future re-adds
    } catch (err) {
      console.error('[AccountManager] Failed to restore configurations:', err);
    }
  };

  // Restore GitHub Actions configuration if available
  const restoreGitHubConfigIfAvailable = async (account: DriveAccount) => {
    try {
      const result = await chrome.storage.local.get(['savedGitHubConfigs']);
      const savedConfigs = result.savedGitHubConfigs || {};
      
      if (savedConfigs[account.email]) {
        const config = savedConfigs[account.email];
        console.log('[AccountManager] Found saved GitHub config for:', account.email, config);
        console.log('[AccountManager] Restoring GitHub config...');
        
        // Get fresh account list from service worker (not stale state)
        const currentAccounts = await sendMessage({ type: 'GET_ACCOUNTS' });
        
        const updatedAccount: DriveAccount = {
          ...account,
          githubOwner: config.githubOwner,
          githubRepo: config.githubRepo,
          githubToken: config.githubToken,
          githubSecretKey: config.githubSecretKey,
          githubEnabled: config.githubEnabled
        };
        
        // Use fresh account list, not stale 'accounts' state
        const updatedAccounts = currentAccounts.map((acc: DriveAccount) => 
          acc.id === account.id ? updatedAccount : acc
        );
        
        await sendMessage({
          type: 'UPDATE_ACCOUNTS',
          payload: updatedAccounts
        });
        
        await loadAccounts();
        
        // Don't delete the saved config - keep it for future re-adds
        console.log('[AccountManager] GitHub config restored successfully');
      }
    } catch (err) {
      console.error('[AccountManager] Failed to restore GitHub config:', err);
    }
  };

  // Save Apps Script configuration for future restoration
  const saveAppsScriptConfigForFutureRestore = async (account: DriveAccount) => {
    // Save if ANY Apps Script configuration exists, even if disabled
    if (account.appsScriptUrl || account.appsScriptSizeLimit) {
      try {
        const result = await chrome.storage.local.get(['savedAppsScriptConfigs']);
        const savedConfigs = result.savedAppsScriptConfigs || {};
        
        savedConfigs[account.email] = {
          appsScriptUrl: account.appsScriptUrl,
          appsScriptEnabled: account.appsScriptEnabled,
          appsScriptSizeLimit: account.appsScriptSizeLimit,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({ savedAppsScriptConfigs: savedConfigs });
        console.log('[AccountManager] Saved Apps Script config for:', account.email, '(enabled:', account.appsScriptEnabled, ')');
      } catch (err) {
        console.error('[AccountManager] Failed to save Apps Script config:', err);
      }
    } else {
      console.log('[AccountManager] No Apps Script config to save for:', account.email);
    }
  };

  // Restore Apps Script configuration if available
  const restoreAppsScriptConfigIfAvailable = async (account: DriveAccount) => {
    try {
      const result = await chrome.storage.local.get(['savedAppsScriptConfigs']);
      const savedConfigs = result.savedAppsScriptConfigs || {};
      
      if (savedConfigs[account.email]) {
        const config = savedConfigs[account.email];
        console.log('[AccountManager] Found saved Apps Script config for:', account.email, config);
        console.log('[AccountManager] Restoring Apps Script config...');
        
        // Get fresh account list from service worker (not stale state)
        const currentAccounts = await sendMessage({ type: 'GET_ACCOUNTS' });
        
        const updatedAccount: DriveAccount = {
          ...account,
          appsScriptUrl: config.appsScriptUrl,
          appsScriptEnabled: config.appsScriptEnabled,
          appsScriptSizeLimit: config.appsScriptSizeLimit
        };
        
        // Use fresh account list, not stale 'accounts' state
        const updatedAccounts = currentAccounts.map((acc: DriveAccount) => 
          acc.id === account.id ? updatedAccount : acc
        );
        
        await sendMessage({
          type: 'UPDATE_ACCOUNTS',
          payload: updatedAccounts
        });
        
        await loadAccounts();
        
        // Don't delete the saved config - keep it for future re-adds
        console.log('[AccountManager] Apps Script config restored successfully');
      }
    } catch (err) {
      console.error('[AccountManager] Failed to restore Apps Script config:', err);
    }
  };

  const handleSwitchAccount = async (accountId: string) => {
    try {
      await sendMessage({
        type: 'SWITCH_ACCOUNT',
        payload: { accountId }
      });
      
      setCurrentAccountId(accountId);
      
      // Reload accounts to update lastUsed timestamps
      await loadAccounts();
      
      // Show success notification (using window alert as we don't have a Snackbar in this component)
      // The parent component will handle the folder refresh via storage listener
    } catch (err: any) {
      setError(`Failed to switch account: ${err.message}`);
    }
  };

  const formatDate = (timestamp: number | undefined) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleDateString();
  };

  // Generate a default secret key name
  // Each account uses its own GitHub repo, so they all use the same secret name
  // but with different values (each account's own refresh token)
  const generateDefaultSecretKey = (account: DriveAccount): string => {
    return 'DRIVE_REFRESH_TOKEN_MAIN';
  };

  const handleEditAccount = (account: DriveAccount) => {
    setEditDialog(account);
    setGithubOwner(account.githubOwner || '');
    setGithubRepo(account.githubRepo || '');
    setGithubToken(account.githubToken || '');
    setGithubSecretKey(account.githubSecretKey || generateDefaultSecretKey(account));
    setGithubEnabled(account.githubEnabled || false);
  };

  const handleSaveGitHubConfig = async () => {
    if (!editDialog) return;

    try {
      const updatedAccount: DriveAccount = {
        ...editDialog,
        githubOwner,
        githubRepo,
        githubToken,
        githubSecretKey: githubEnabled ? githubSecretKey : undefined,
        githubEnabled
      };

      // Update the account
      const updatedAccounts = accounts.map(acc => 
        acc.id === editDialog.id ? updatedAccount : acc
      );

      await sendMessage({
        type: 'UPDATE_ACCOUNTS',
        payload: updatedAccounts
      });

      await loadAccounts();
      setEditDialog(null);
    } catch (err: any) {
      setError(`Failed to save GitHub config: ${err.message}`);
    }
  };

  const handleOpenAppsScriptDialog = (account: DriveAccount) => {
    setAppsScriptDialog(account);
    setAppsScriptUrl(account.appsScriptUrl || '');
    setAppsScriptEnabled(account.appsScriptEnabled || false);
    setAppsScriptSizeLimit(account.appsScriptSizeLimit || 50);
  };

  const handleSaveAppsScriptConfig = async () => {
    if (!appsScriptDialog) return;

    try {
      const updatedAccount: DriveAccount = {
        ...appsScriptDialog,
        appsScriptUrl: appsScriptEnabled ? appsScriptUrl : undefined,
        appsScriptEnabled,
        appsScriptSizeLimit: appsScriptEnabled ? appsScriptSizeLimit : undefined,
      };

      const updatedAccounts = accounts.map(acc =>
        acc.id === appsScriptDialog.id ? updatedAccount : acc
      );

      await sendMessage({
        type: 'UPDATE_ACCOUNTS',
        payload: updatedAccounts
      });

      await loadAccounts();
      setAppsScriptDialog(null);
    } catch (err: any) {
      setError(`Failed to save Apps Script config: ${err.message}`);
    }
  };

  const handleAppsScriptQuickSetup = async (account: DriveAccount) => {
    setAppsScriptQuickSetupAccount(account);
    setAppsScriptQuickSetupOpen(true);
    setAppsScriptDialog(null);
    
    // Save state to persist across extension reopens (for auto-resume)
    await chrome.storage.local.set({
      appsScriptSetupState: {
        accountEmail: account.email,
        timestamp: Date.now()
      }
    });
  };

  const handleAppsScriptQuickSetupSave = async (config: { webAppUrl: string }) => {
    if (!appsScriptQuickSetupAccount) return;

    try {
      const updatedAccount: DriveAccount = {
        ...appsScriptQuickSetupAccount,
        appsScriptUrl: config.webAppUrl,
        appsScriptEnabled: true,
      };

      const updatedAccounts = accounts.map(acc =>
        acc.id === appsScriptQuickSetupAccount.id ? updatedAccount : acc
      );

      await sendMessage({
        type: 'UPDATE_ACCOUNTS',
        payload: updatedAccounts
      });

      await loadAccounts();
      setAppsScriptQuickSetupOpen(false);
      setAppsScriptQuickSetupAccount(null);
      
      // Clear auto-resume state since setup is complete
      await chrome.storage.local.remove(['appsScriptSetupState']);
    } catch (err: any) {
      setError(`Failed to save Apps Script config: ${err.message}`);
    }
  };

  const handleQuickSetup = async (account: DriveAccount) => {
    setQuickSetupAccount(account);
    setQuickSetupOpen(true);
    setEditDialog(null);
    
    // Save state to persist across extension reopens
    await chrome.storage.local.set({
      quickSetupState: {
        accountEmail: account.email,
        timestamp: Date.now()
      }
    });
  };

  const handleQuickSetupSave = async (config: { owner: string; repo: string; token: string }) => {
    if (!quickSetupAccount) return;

    try {
      const updatedAccount: DriveAccount = {
        ...quickSetupAccount,
        githubOwner: config.owner,
        githubRepo: config.repo,
        githubToken: config.token,
        githubSecretKey: quickSetupAccount.githubSecretKey || generateDefaultSecretKey(quickSetupAccount),
        githubEnabled: true
      };

      const updatedAccounts = accounts.map(acc => 
        acc.id === quickSetupAccount.id ? updatedAccount : acc
      );

      await sendMessage({
        type: 'UPDATE_ACCOUNTS',
        payload: updatedAccounts
      });

      await loadAccounts();
      setQuickSetupOpen(false);
      setQuickSetupAccount(null);
      
      // Clear persisted state on successful save
      await chrome.storage.local.remove(['quickSetupState']);
    } catch (err: any) {
      setError(`Failed to save GitHub config: ${err.message}`);
    }
  };

  return (
    <Box>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        mb: 3 
      }}>
        <Typography variant="h5" fontWeight="600">Google Drive Accounts</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={handleAddAccount}
            disabled={loading}
            sx={{ 
              borderRadius: 2, 
              textTransform: 'none',
              px: 3,
              py: 1
            }}
          >
            Add Account
          </Button>
          <IconButton 
            size="medium" 
            onClick={() => setShowHelp(!showHelp)}
            sx={{ 
              bgcolor: showHelp ? 'primary.main' : 'transparent',
              color: showHelp ? 'primary.contrastText' : 'inherit',
              '&:hover': {
                bgcolor: showHelp ? 'primary.dark' : 'action.hover'
              }
            }}
          >
            <HelpOutlineIcon />
          </IconButton>
        </Box>
      </Box>

      <Collapse in={showHelp}>
        <Alert 
          severity="info" 
          sx={{ 
            mb: 3, 
            borderRadius: 2,
            '& .MuiAlert-message': {
              width: '100%'
            }
          }}
        >
          <Typography variant="body2" fontWeight="600" gutterBottom>
            What is this?
          </Typography>
          <Typography variant="body2" paragraph sx={{ mb: 2 }}>
            Manage multiple Google Drive accounts in one extension. Each account can have its own 
            default folder, GitHub Actions configuration, and Cloud Run service settings.
          </Typography>
          <Typography variant="body2" paragraph sx={{ mb: 2 }}>
            • <strong>Default Account:</strong> The account used for new uploads<br />
            • <strong>GitHub Actions:</strong> Configure automated workflows for each account<br />
            • <strong>Profile Pictures:</strong> Automatically loaded from your Google account
          </Typography>
          <Typography variant="body2">
            Click <strong>Add Account</strong> to sign in with additional Google accounts.
          </Typography>
        </Alert>
      </Collapse>

      {error && (
        <Alert 
          severity="error" 
          onClose={() => setError(null)} 
          sx={{ mb: 3, borderRadius: 2 }}
        >
          {error}
        </Alert>
      )}

      {accounts.length === 0 ? (
        <Card 
          variant="outlined" 
          sx={{ 
            borderRadius: 3, 
            textAlign: 'center', 
            py: 6,
            bgcolor: 'background.default'
          }}
        >
          <CardContent>
            <PersonAddIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="body1" color="text.secondary">
              No accounts connected. Add an account to get started.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {accounts.map((account) => (
            <Card 
              key={account.id}
              variant="outlined"
              sx={{ 
                borderRadius: 3,
                transition: 'all 0.2s ease-in-out',
                border: '1px solid',
                borderColor: currentAccountId === account.id ? 'primary.main' : 'divider',
                '&:hover': {
                  boxShadow: 2,
                  borderColor: 'primary.main'
                }
              }}
            >
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  {/* Avatar with Profile Picture */}
                  <Avatar 
                    src={account.picture}
                    sx={{ 
                      width: 48, 
                      height: 48, 
                      bgcolor: 'primary.main',
                      fontSize: '1.25rem',
                      fontWeight: 600
                    }}
                  >
                    {!account.picture && account.email.charAt(0).toUpperCase()}
                  </Avatar>

                  {/* Account Info */}
                  <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                    {/* Email - Always full width, no truncation */}
                    <Typography 
                      variant="subtitle1" 
                      fontWeight="600"
                      sx={{ 
                        fontSize: '1rem',
                        mb: 0.5,
                        wordBreak: 'break-all'
                      }}
                    >
                      {account.email}
                    </Typography>
                    
                    {/* Default chip - Always on separate line below email */}
                    {currentAccountId === account.id && (
                      <Box sx={{ mb: 0.5 }}>
                        <Chip
                          label="Default"
                          size="small"
                          color="primary"
                          icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
                          sx={{ 
                            height: 22,
                            borderRadius: 1.5,
                            fontWeight: 600,
                            fontSize: '0.7rem',
                            '& .MuiChip-icon': {
                              ml: 0.5
                            }
                          }}
                        />
                      </Box>
                    )}
                    
                    {/* Name if available */}
                    {account.name && (
                      <Typography 
                        variant="body2" 
                        color="text.secondary"
                        sx={{ 
                          mb: 0.5,
                          fontSize: '0.875rem'
                        }}
                      >
                        {account.name}
                      </Typography>
                    )}
                    
                    {/* Dates */}
                    <Box>
                      <Typography 
                        variant="caption" 
                        color="text.secondary"
                        sx={{ fontSize: '0.75rem', display: 'block' }}
                      >
                        Added: {formatDate(account.createdAt)}
                      </Typography>
                      {account.lastUsed && (
                        <Typography 
                          variant="caption" 
                          color="text.secondary"
                          sx={{ fontSize: '0.75rem', display: 'block' }}
                        >
                          Last used: {formatDate(account.lastUsed)}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Action Buttons - Compact */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>
                    <IconButton
                      onClick={() => handleOpenAppsScriptDialog(account)}
                      title="Configure Google Apps Script"
                      sx={{ 
                        bgcolor: account.appsScriptEnabled ? 'secondary.main' : 'transparent',
                        color: account.appsScriptEnabled ? 'secondary.contrastText' : 'inherit',
                        border: account.appsScriptEnabled ? 'none' : '1px solid',
                        borderColor: 'divider',
                        '&:hover': {
                          bgcolor: account.appsScriptEnabled ? 'secondary.dark' : 'action.hover'
                        }
                      }}
                    >
                      <WebhookIcon />
                    </IconButton>
                    
                    <IconButton
                      onClick={() => handleEditAccount(account)}
                      title="Configure GitHub Actions"
                      sx={{ 
                        bgcolor: account.githubEnabled ? 'primary.main' : 'transparent',
                        color: account.githubEnabled ? 'primary.contrastText' : 'inherit',
                        border: account.githubEnabled ? 'none' : '1px solid',
                        borderColor: 'divider',
                        '&:hover': {
                          bgcolor: account.githubEnabled ? 'primary.dark' : 'action.hover'
                        }
                      }}
                    >
                      <GitHubIcon />
                    </IconButton>
                    
                    {currentAccountId !== account.id && (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleSwitchAccount(account.id)}
                        sx={{ 
                          borderRadius: 2,
                          textTransform: 'none',
                          minWidth: 100,
                          fontSize: '0.8125rem'
                        }}
                      >
                        Set Default
                      </Button>
                    )}
                    
                    <IconButton
                      size="small"
                      onClick={() => setDeleteDialog(account.id)}
                      disabled={accounts.length === 1 && currentAccountId === account.id}
                      title={
                        accounts.length === 1 && currentAccountId === account.id
                          ? 'Cannot delete the only active account'
                          : 'Remove account'
                      }
                      sx={{ 
                        color: 'error.main',
                        '&:hover': {
                          bgcolor: 'error.lighter'
                        }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={!!deleteDialog} 
        onClose={() => setDeleteDialog(null)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 4 }
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 2 }}>
          <DeleteIcon color="error" />
          <Typography variant="h6" component="span">
            Remove Account?
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body1" gutterBottom sx={{ mb: 3 }}>
            Are you sure you want to remove this Google Drive account from the extension?
          </Typography>
          
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              <strong>What happens:</strong>
            </Typography>
            <Typography variant="body2" component="div">
              • Account will be logged out from this extension
              <br />
              • Local settings will be removed
              <br />
              • ✅ GitHub Actions configuration will be preserved
              <br />
              • ✅ Google Apps Script configuration will be preserved
            </Typography>
          </Alert>

          <Alert severity="info">
            <Typography variant="body2" gutterBottom>
              <strong>To re-add this account:</strong>
            </Typography>
            <Typography variant="body2" component="div">
              1. Click the "Add Account" button
              <br />
              2. Sign in with the same Google account
              <br />
              3. ✨ GitHub Actions and Apps Script configurations will be automatically restored!
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setDeleteDialog(null)}>Cancel</Button>
          <Button
            onClick={() => deleteDialog && handleRemoveAccount(deleteDialog)}
            color="error"
            variant="contained"
            startIcon={<DeleteIcon />}
          >
            Remove Account
          </Button>
        </DialogActions>
      </Dialog>

      {/* GitHub Configuration Dialog */}
      <Dialog 
        open={!!editDialog} 
        onClose={() => setEditDialog(null)} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{
          sx: { borderRadius: 4 }
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <GitHubIcon />
              <Typography variant="h6" component="span" sx={{ m: '0px 0px 0px 10px' }}>
                GitHub Actions Configuration
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              onClick={() => editDialog && handleQuickSetup(editDialog)}
            >
              Quick Setup
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ m: '0px', pb: '16px' }}>
            Configure GitHub Actions backend for {editDialog?.email}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={githubEnabled}
                onChange={(e) => setGithubEnabled(e.target.checked)}
              />
            }
            label="Enable GitHub Actions for this account"
            sx={{ mb: 3, display: 'flex', ml: 0 }}
            componentsProps={{
              typography: { sx: { ml: '10px' } }
            }}
          />

          {githubEnabled && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                fullWidth
                label="GitHub Owner"
                value={githubOwner}
                onChange={(e) => setGithubOwner(e.target.value)}
                placeholder="your-username"
                helperText="Your GitHub username or organization"
              />
              <TextField
                fullWidth
                label="Repository Name"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="drive-uploader-actions"
                helperText="Repository containing the workflow"
              />
              <TextField
                fullWidth
                label="Personal Access Token"
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="github_pat_..."
                helperText="Fine-grained PAT with Actions: Read/Write"
              />
              <TextField
                fullWidth
                required
                label="GitHub Secret Key"
                value={githubSecretKey}
                onChange={(e) => setGithubSecretKey(e.target.value.toUpperCase())}
                placeholder="DRIVE_REFRESH_TOKEN_MAIN"
                helperText="Name of the GitHub secret containing this account's refresh token"
                InputProps={{
                  sx: { fontFamily: 'monospace' }
                }}
              />
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>Important:</strong> Add this secret to YOUR repository (each account uses its own repo):<br />
                  Go to: <code style={{ fontSize: '0.85em' }}>Settings → Secrets → Actions</code><br />
                  Name: <code style={{ fontSize: '0.85em' }}>{githubSecretKey}</code><br />
                  Value: This account's refresh token
                </Typography>
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditDialog(null)}>Cancel</Button>
          <Button
            onClick={handleSaveGitHubConfig}
            variant="contained"
            disabled={githubEnabled && (!githubOwner || !githubRepo || !githubToken || !githubSecretKey)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Apps Script Configuration Dialog */}
      <Dialog
        open={!!appsScriptDialog}
        onClose={() => setAppsScriptDialog(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 4 }
        }}
      >
        <DialogTitle sx={{ pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <WebhookIcon />
              <Typography variant="h6" component="span">
                Google Apps Script Configuration
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              onClick={() => appsScriptDialog && handleAppsScriptQuickSetup(appsScriptDialog)}
            >
              Quick Setup
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Configure Google Apps Script backend for {appsScriptDialog?.email}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={appsScriptEnabled}
                onChange={(e) => setAppsScriptEnabled(e.target.checked)}
              />
            }
            label="Enable Google Apps Script for this account"
            sx={{ mb: 3, display: 'flex', ml: 0 }}
            componentsProps={{
              typography: { sx: { ml: '10px' } }
            }}
          />

          {appsScriptEnabled && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                fullWidth
                label="Web App URL"
                value={appsScriptUrl}
                onChange={(e) => setAppsScriptUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                helperText="Deploy your Apps Script as a Web App and paste the URL here"
              />
              
              <Box sx={{ mt: 3 }}>
                <Typography variant="body2" gutterBottom>
                  File Size Limit: <strong>{appsScriptSizeLimit} MB</strong>
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                  Files larger than this limit will use GitHub Actions instead
                </Typography>
                <Slider
                  value={appsScriptSizeLimit}
                  onChange={(_, value) => setAppsScriptSizeLimit(value as number)}
                  min={50}
                  max={300}
                  step={10}
                  marks={[
                    { value: 50, label: '50 MB' },
                    { value: 100, label: '100 MB' },
                    { value: 150, label: '150 MB' },
                    { value: 200, label: '200 MB' },
                    { value: 250, label: '250 MB' },
                    { value: 300, label: '300 MB' },
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value} MB`}
                  sx={{ mt: 2 }}
                />
              </Box>
              
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Best for:</strong> Small to medium files. Apps Script has a 6-minute execution limit.
                  <br /><br />
                  <strong>⚠️ Warning:</strong> Files above 100 MB may fail due to timeout. The 50 MB default is recommended for reliability.
                  <br /><br />
                  <strong>How it works:</strong> The extension sends a POST request with the file URL. The script fetches the file and saves it to your Drive.
                </Typography>
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setAppsScriptDialog(null)}>Cancel</Button>
          <Button
            onClick={handleSaveAppsScriptConfig}
            variant="contained"
            disabled={appsScriptEnabled && !appsScriptUrl.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Apps Script Quick Setup Wizard */}
      <AppsScriptQuickSetup
        open={appsScriptQuickSetupOpen}
        accountEmail={appsScriptQuickSetupAccount?.email || ''}
        onClose={async () => {
          setAppsScriptQuickSetupOpen(false);
          setAppsScriptQuickSetupAccount(null);
          // Clear auto-resume state when dialog closes (via Cancel or close button)
          await chrome.storage.local.remove(['appsScriptSetupState']);
        }}
        onSave={handleAppsScriptQuickSetupSave}
      />

      {/* GitHub Quick Setup Wizard */}
      <GitHubQuickSetup
        open={quickSetupOpen}
        accountEmail={quickSetupAccount?.email || ''}
        onClose={async () => {
          setQuickSetupOpen(false);
          setQuickSetupAccount(null);
          // Clear persisted state when user cancels
          await chrome.storage.local.remove(['quickSetupState']);
        }}
        onSave={handleQuickSetupSave}
      />
    </Box>
  );
}
