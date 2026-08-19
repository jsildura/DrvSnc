import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { StorageQuota } from '../lib/types';
import { sendMessage } from '../lib/messaging';

export interface StorageDisplayRef {
  refresh: () => void;
}

const StorageDisplay = forwardRef<StorageDisplayRef>((props, ref) => {
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string>('');

  useEffect(() => {
    loadStorageQuota();
    loadAccountInfo();
  }, []);

  const loadAccountInfo = async () => {
    try {
      const prefs = await sendMessage<any>({ type: 'GET_PREFS' });
      if (prefs?.defaultAccountId) {
        // Get accounts to find the email
        const result = await chrome.storage.local.get(['driveAccounts']);
        const accounts = result.driveAccounts || [];
        const currentAccount = accounts.find((a: any) => a.id === prefs.defaultAccountId);
        if (currentAccount?.email) {
          setAccountEmail(currentAccount.email);
        }
      }
    } catch (err) {
      console.error('Failed to load account info:', err);
    }
  };

  const loadStorageQuota = async () => {
    console.log('[StorageDisplay] loadStorageQuota called');
    setLoading(true);
    try {
      console.log('[StorageDisplay] Requesting storage quota');
      const storageQuota = await sendMessage<StorageQuota>({ type: 'GET_STORAGE_QUOTA' });
      console.log('[StorageDisplay] Received quota:', storageQuota);
      setQuota(storageQuota);
    } catch (err: any) {
      console.error('[StorageDisplay] Failed to load storage quota:', err);
    } finally {
      setLoading(false);
      console.log('[StorageDisplay] loadStorageQuota complete');
    }
  };

  // Expose refresh function to parent
  useImperativeHandle(ref, () => ({
    refresh: loadStorageQuota
  }));

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getUsagePercentage = () => {
    if (!quota || quota.limit === 0) return 0;
    return (quota.usage / quota.limit) * 100;
  };

  const getUsageColor = () => {
    const percentage = getUsagePercentage();
    if (percentage >= 90) return 'error';
    if (percentage >= 75) return 'warning';
    return 'primary';
  };

  if (!quota) {
    return (
      <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          component="img"
          src="/icons/drive_2020q4_48dp.png"
          alt="Drive Icon"
          sx={{ width: 24, height: 24 }}
        />
        <Typography variant="body2" color="text.secondary">
          {loading ? 'Loading storage...' : 'Storage info unavailable'}
        </Typography>
        {!loading && (
          <IconButton size="small" onClick={loadStorageQuota}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        )}
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="img"
            src="/icons/drive_2020q4_48dp.png"
            alt="Drive Icon"
            sx={{ width: 24, height: 24 }}
          />
          <Typography variant="subtitle2" fontWeight={600}>
            Google Drive Storage
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {accountEmail && (
            <Typography variant="caption" color="text.secondary">
              {accountEmail}
            </Typography>
          )}
          <Tooltip title="Refresh storage">
            <IconButton size="small" onClick={loadStorageQuota} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ mb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {formatBytes(quota.usage)} of {formatBytes(quota.limit)} used
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {getUsagePercentage().toFixed(1)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={getUsagePercentage()}
          color={getUsageColor()}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: 'action.hover',
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mt: 1.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Drive Files
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {formatBytes(quota.usageInDrive)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            In Trash
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {formatBytes(quota.usageInTrash)} {/* {quota.usageInTrash} bytes */}
            <Box component="span" sx={{ display: 'none' }}>
              {/* Hidden debug element to force re-render when quota changes */}
              data-quota={JSON.stringify({trash: quota.usageInTrash, time: new Date().getTime()})} 
            </Box>
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto' }}>
          <Typography variant="caption" color="text.secondary">
            Available
          </Typography>
          <Typography variant="body2" fontWeight={600} color="success.main">
            {formatBytes(quota.limit - quota.usage)}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
});

export default StorageDisplay;
