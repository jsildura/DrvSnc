import React, { useEffect, useState } from 'react';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import type { UserPreferences, DriveFolder } from '../lib/types';
import { sendMessage } from '../lib/messaging';
import AccountManager from './AccountManager';
import ServiceConfigManager from './ServiceConfigManager';

type Props = {
  compact?: boolean;
};

export default function SettingsContent({ compact = false }: Props) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState(0);

  useEffect(() => {
    // Load preferences
    sendMessage<UserPreferences>({ type: 'GET_PREFS' })
      .then((prefs) => {
        setPreferences(prefs);
      })
      .catch((err) => {
        setError(`Failed to load preferences: ${err.message}`);
      });

    // Load folders
    sendMessage<DriveFolder[]>({ type: 'LIST_FOLDERS' })
      .then((folderList) => {
        setFolders(folderList);
      })
      .catch(() => {
        // Ignore error, user may not be signed in
      });
  }, []);

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setError(null);
      setSuccess(false);
      await sendMessage({ type: 'UPDATE_PREFS', payload: preferences });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear upload history and completed uploads?')) {
      try {
        // Clear upload history
        await sendMessage({ type: 'CLEAR_HISTORY' });
        // Clear completed jobs from queue
        await sendMessage({ type: 'CLEAR_COMPLETED_JOBS' });
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  if (!preferences) {
    return <Typography>Loading...</Typography>;
  }

  const Wrapper: React.ElementType = compact ? Box : Paper;
  const wrapperProps = compact ? {} : { sx: { p: 3 } };

  return (
    <Box>
      {!compact && (
        <Tabs value={tabIndex} onChange={(_, newValue) => setTabIndex(newValue)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="General" />
          <Tab label="Accounts" />
          <Tab label="Cloud Run" />
        </Tabs>
      )}

      {/* Tab 0: General Settings */}
      {(compact || tabIndex === 0) && (
        <Stack spacing={compact ? 2 : 3}>
          {error && (
            <Alert 
              severity="error" 
              onClose={() => setError(null)}
              sx={{ borderRadius: 2 }}
            >
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ borderRadius: 2 }}>
              Settings saved successfully!
            </Alert>
          )}

          {/* Upload Defaults Section */}
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3, 
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                boxShadow: 2,
                borderColor: 'primary.main'
              }
            }}
          >
            <Typography variant="h6" fontWeight="600" gutterBottom>
              Upload Defaults
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Configure default settings for file uploads
            </Typography>

            <Stack spacing={3}>
              <FormControl fullWidth size={compact ? 'small' : 'medium'}>
                <InputLabel>Default Folder</InputLabel>
                <Select
                  value={preferences.defaultFolderId || 'root'}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      defaultFolderId: e.target.value,
                      defaultFolderName:
                        folders.find((f) => f.id === e.target.value)?.name || 'My Drive',
                    })
                  }
                  label="Default Folder"
                  sx={{ borderRadius: 2 }}
                >
                  {folders.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                size={compact ? 'small' : 'medium'}
                label="Filename Pattern"
                value={preferences.filenamePattern}
                onChange={(e) =>
                  setPreferences({ ...preferences, filenamePattern: e.target.value })
                }
                helperText="Use ${basename} for original name, ${ext} for extension"
                InputProps={{
                  sx: { borderRadius: 2 }
                }}
              />
            </Stack>
          </Paper>

          {/* Appearance Section */}
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3, 
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                boxShadow: 2,
                borderColor: 'primary.main'
              }
            }}
          >
            <Typography variant="h6" fontWeight="600" gutterBottom>
              Appearance
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Customize the look and feel of the extension
            </Typography>

            <Stack spacing={3}>
              <FormControl fullWidth size={compact ? 'small' : 'medium'}>
                <InputLabel>Theme</InputLabel>
                <Select
                  value={preferences.theme}
                  onChange={(e) =>
                    setPreferences({ ...preferences, theme: e.target.value as any })
                  }
                  label="Theme"
                  sx={{ borderRadius: 2 }}
                >
                  <MenuItem value="system">System</MenuItem>
                  <MenuItem value="light">Light</MenuItem>
                  <MenuItem value="dark">Dark</MenuItem>
                </Select>
              </FormControl>

              <Box>
                <Typography variant="subtitle2" fontWeight="600" gutterBottom sx={{ mb: 2 }}>
                  Color Scheme
                </Typography>
                <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
                  {[
                    { 
                      value: 'default', 
                      label: 'Default',
                      color: '#6750A4' // Purple
                    },
                    { 
                      value: 'cool', 
                      label: 'Cool',
                      color: '#0061A4' // Deep Blue
                    },
                    { 
                      value: 'warm', 
                      label: 'Warm',
                      color: '#C4401C' // Burnt Orange
                    },
                    { 
                      value: 'crimson', 
                      label: 'Crimson',
                      color: '#C62828' // Deep Red
                    },
                    { 
                      value: 'morandi', 
                      label: 'Morandi',
                      color: '#6B6B6B' // Gray
                    },
                    { 
                      value: 'ocean', 
                      label: 'Ocean',
                      color: '#006A6A' // Teal
                    },
                    { 
                      value: 'sunset', 
                      label: 'Sunset',
                      color: '#FF6F3C' // Coral Orange (distinct from warm/amber)
                    },
                    { 
                      value: 'forest', 
                      label: 'Forest',
                      color: '#386A1F' // Forest Green
                    },
                    { 
                      value: 'emerald', 
                      label: 'Emerald',
                      color: '#00897B' // Rich Green
                    },
                    { 
                      value: 'amber', 
                      label: 'Amber',
                      color: '#FFA726' // Golden Amber (brighter, distinct)
                    },
                    { 
                      value: 'bronze', 
                      label: 'Bronze',
                      color: '#8D6E63' // Metallic Brown
                    },
                    { 
                      value: 'berry', 
                      label: 'Berry',
                      color: '#9F2460' // Berry Red
                    },
                    { 
                      value: 'indigo', 
                      label: 'Indigo',
                      color: '#3F51B5' // Deep Blue-Purple
                    },
                    { 
                      value: 'drive', 
                      label: 'Drive',
                      color: 'linear-gradient(135deg, #1A73E8 0%, #0F9D58 35%, #F9AB00 65%, #EA4335 100%)' // Keep gradient
                    },
                  ].map((scheme) => (
                    <Box
                      key={scheme.value}
                      onClick={() => 
                        setPreferences({ 
                          ...preferences, 
                          colorScheme: scheme.value as any 
                        })
                      }
                      sx={{
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                        }
                      }}
                    >
                      <Box
                        sx={{
                          width: 50,
                          height: 50,
                          borderRadius: '50%',
                          background: scheme.color,
                          border: '2px solid',
                          borderColor: preferences.colorScheme === scheme.value 
                            ? 'primary.main' 
                            : 'divider',
                          boxShadow: preferences.colorScheme === scheme.value
                            ? 2
                            : 1,
                          transition: 'all 0.2s ease-in-out',
                          mb: 1,
                          position: 'relative',
                          overflow: 'hidden',
                          '&::after': preferences.colorScheme === scheme.value ? {
                            content: '"✓"',
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            fontSize: '1.5rem',
                            color: 'white',
                            fontWeight: 'bold',
                            textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                          } : {}
                        }}
                      />
                      <Typography 
                        variant="caption" 
                        fontWeight={preferences.colorScheme === scheme.value ? 600 : 400}
                        sx={{ 
                          color: preferences.colorScheme === scheme.value 
                            ? 'primary.main' 
                            : 'text.secondary'
                        }}
                      >
                        {scheme.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Stack>
          </Paper>

          {/* Notifications Section */}
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3, 
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                boxShadow: 2,
                borderColor: 'primary.main'
              }
            }}
          >
            <Typography variant="h6" fontWeight="600" gutterBottom>
              Notifications
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Manage notification preferences
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.notificationsEnabled}
                  onChange={(e) =>
                    setPreferences({ ...preferences, notificationsEnabled: e.target.checked })
                  }
                />
              }
              label="Show upload completion notifications"
              sx={{ ml: 0 }}
              componentsProps={{
                typography: { sx: { ml: '10px' } }
              }}
            />
          </Paper>

          {/* Data Management Section */}
          <Paper 
            elevation={0} 
            sx={{ 
              p: 3, 
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                boxShadow: 2,
                borderColor: 'error.main'
              }
            }}
          >
            <Typography variant="h6" fontWeight="600" gutterBottom>
              Data Management
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Clear stored data and upload history
            </Typography>

            <Button 
              variant="outlined" 
              color="error" 
              onClick={handleClearHistory} 
              size={compact ? 'small' : 'medium'}
              sx={{ 
                borderRadius: 2,
                textTransform: 'none',
                px: 3
              }}
            >
              Clear Upload History
            </Button>
          </Paper>

          <Divider sx={{ my: 2 }} />

          {/* Save Button */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            <Button 
              variant="contained" 
              onClick={handleSave} 
              size={compact ? 'small' : 'medium'}
              sx={{ 
                borderRadius: 2,
                textTransform: 'none',
                px: 4,
                py: 1.5,
                fontWeight: 600
              }}
            >
              Save Settings
            </Button>
          </Box>
        </Stack>
      )}

      {/* Tab 1: Account Management */}
      {!compact && tabIndex === 1 && (
        <Box sx={{ p: 3 }}>
          <AccountManager />
        </Box>
      )}

      {/* Tab 2: Cloud Run Configuration */}
      {!compact && tabIndex === 2 && (
        <Box sx={{ p: 3 }}>
          <ServiceConfigManager />
        </Box>
      )}
    </Box>
  );
}
