import React, { useState, useCallback } from 'react';
import {
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  CircularProgress,
  Alert,
  Box,
  Paper
} from '@mui/material';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import { sendMessage } from '../lib/messaging';

// Interface for a Google Drive folder
interface SharedFolder {
  id: string;
  name: string;
}

/**
 * A React component that detects and lists folders shared with the user in Google Drive.
 * Integrated with the extension's messaging system for authorization.
 */
const SharedFolderDetector: React.FC = () => {
  const [folders, setFolders] = useState<SharedFolder[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetches the list of shared folders using the extension's messaging system
   * to communicate with the service worker.
   */
  const fetchSharedFolders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFolders([]);

    try {
      // Use our extension's messaging system to fetch shared folders
      const sharedFolders = await sendMessage<SharedFolder[]>({
        type: 'GET_SHARED_FOLDERS'
      });

      if (Array.isArray(sharedFolders) && sharedFolders.length > 0) {
        setFolders(sharedFolders);
      } else {
        console.log('No shared folders found or invalid response');
      }
    } catch (err: any) {
      setError(`Failed to fetch shared folders: ${err.message}`);
      console.error('Error fetching shared folders:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Paper elevation={3} sx={{ m: 2, p: 3, borderRadius: 2 }}>
      <Typography variant="h5" component="h2" gutterBottom>
        Shared Drive Folders
      </Typography>
      
      {/* Note about API scopes */}
      <Alert severity="info" sx={{ mb: 2 }}>
        This component uses the <code>drive.metadata.readonly</code> scope 
        to detect folders that have been shared with you.
      </Alert>

      <Box sx={{ my: 2 }}>
        <Button 
          variant="contained" 
          onClick={fetchSharedFolders} 
          disabled={loading}
        >
          {loading ? <CircularProgress size={24} sx={{ mr: 1 }} /> : null}
          {loading ? 'Finding Shared Folders...' : 'Find Shared Folders'}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ my: 2 }}>
          {error}
        </Alert>
      )}

      {folders.length > 0 && (
        <List>
          {folders.map(folder => (
            <ListItem key={folder.id}>
              <ListItemIcon>
                <FolderSharedIcon color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary={folder.name} 
                secondary={`ID: ${folder.id}`} 
              />
            </ListItem>
          ))}
        </List>
      )}

      {!loading && !error && folders.length === 0 && (
        <Typography variant="body1" sx={{ mt: 2 }}>
          Click the button to search for shared folders.
        </Typography>
      )}
    </Paper>
  );
};

export default SharedFolderDetector;
