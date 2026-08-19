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
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { ServiceConfig } from '../lib/types';
import { sendMessage } from '../lib/messaging';

export default function ServiceConfigManager() {
  const [config, setConfig] = useState<ServiceConfig>({
    cloudRunUrl: '',
    appKey: '',
    enabled: false,
  });
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const serviceConfig = await sendMessage<ServiceConfig | null>({ type: 'GET_SERVICE_CONFIG' });
      if (serviceConfig) {
        setConfig(serviceConfig);
      }
    } catch (err: any) {
      setError(`Failed to load configuration: ${err.message}`);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Validate inputs
      if (config.enabled) {
        if (!config.cloudRunUrl.trim()) {
          throw new Error('Cloud Run URL is required when enabled');
        }
        if (!config.appKey.trim()) {
          throw new Error('API Key is required when enabled');
        }
        
        // Validate URL format
        try {
          new URL(config.cloudRunUrl);
        } catch {
          throw new Error('Invalid Cloud Run URL format');
        }
      }

      await sendMessage({
        type: 'UPDATE_SERVICE_CONFIG',
        payload: config
      });

      // Also update preference to use server upload
      await sendMessage({
        type: 'UPDATE_PREFS',
        payload: { useServerUpload: config.enabled }
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight="600" gutterBottom>
            Cloud Run Service
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure server-side uploads for remote URLs
          </Typography>
        </Box>
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
            The Cloud Run service enables server-side uploads from remote URLs, bypassing CORS 
            restrictions and supporting files up to 3GB. Local file uploads always use direct 
            client-side upload.
          </Typography>
          <Typography variant="body2">
            See the <code style={{ 
              padding: '2px 6px', 
              backgroundColor: 'rgba(0,0,0,0.1)', 
              borderRadius: '4px',
              fontFamily: 'monospace'
            }}>cloudrun-remote-uploader/README.md</code> for deployment instructions.
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

      {success && (
        <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
          Configuration saved successfully!
        </Alert>
      )}

      <Card 
        variant="outlined"
        sx={{ 
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            boxShadow: 2,
            borderColor: config.enabled ? 'primary.main' : 'divider'
          }
        }}
      >
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={config.enabled}
                    onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body1" fontWeight="600">
                      Enable Server-Side Uploads
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Use Cloud Run service for remote URL uploads
                    </Typography>
                  </Box>
                }
                sx={{ ml: 0, alignItems: 'flex-start' }}
                componentsProps={{
                  typography: { sx: { ml: '10px' } }
                }}
              />
            </Box>

            <Box 
              sx={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 3,
                opacity: config.enabled ? 1 : 0.5,
                transition: 'opacity 0.2s ease-in-out'
              }}
            >
              <TextField
                label="Cloud Run Service URL"
                placeholder="https://your-service-xxxxx.run.app"
                value={config.cloudRunUrl}
                onChange={(e) => setConfig({ ...config, cloudRunUrl: e.target.value })}
                disabled={!config.enabled}
                fullWidth
                helperText="The base URL of your deployed Cloud Run service"
                InputProps={{
                  sx: { borderRadius: 2 }
                }}
              />

              <TextField
                label="API Key (APP_KEY)"
                type={showKey ? 'text' : 'password'}
                value={config.appKey}
                onChange={(e) => setConfig({ ...config, appKey: e.target.value })}
                disabled={!config.enabled}
                fullWidth
                helperText="The shared secret key configured in Cloud Run secrets"
                InputProps={{
                  sx: { borderRadius: 2 },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowKey(!showKey)}
                        edge="end"
                        disabled={!config.enabled}
                      >
                        {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={loading}
              fullWidth
              sx={{ 
                borderRadius: 2,
                textTransform: 'none',
                py: 1.5,
                fontWeight: 600,
                fontSize: '1rem'
              }}
            >
              {loading ? 'Saving...' : 'Save Configuration'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Alert 
        severity="warning" 
        sx={{ 
          mt: 3, 
          borderRadius: 2,
          bgcolor: 'transparent',
          border: '2px solid',
          borderColor: 'warning.main',
          '& .MuiAlert-icon': {
            color: 'warning.main'
          }
        }}
      >
        <Typography variant="body2">
          <strong>Security Note:</strong> The API key is stored locally in your browser. 
          Only share it with trusted Cloud Run deployments you control.
        </Typography>
      </Alert>
    </Box>
  );
}
