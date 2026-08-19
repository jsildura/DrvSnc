import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Menu,
  MenuItem,
  Breadcrumbs,
  Link,
  Chip,
  CircularProgress,
  Alert,
  Paper,
  Select,
  FormControl,
  InputLabel,
  LinearProgress,
  Grid,
  Stack,
  Snackbar,
  Tooltip,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SharedFolderIcon from './SharedFolderIcon';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import GetAppIcon from '@mui/icons-material/GetApp';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ShareIcon from '@mui/icons-material/Share';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Checkbox from '@mui/material/Checkbox';
import ShareDialog from './ShareDialog';
import SearchComponent, { SearchParams } from './SearchComponent';
import JSZip from 'jszip';
import FolderTreeView from '../popup/FolderTreeView';
import SharedWithMeView from './SharedWithMeView';

// Custom SVG Icons
const TrashIcon = () => (
  <svg width="24px" height="24px" viewBox="0 0 24 24" fill="currentColor" focusable="false">
    <g><path d="M0,0h24v24H0V0z" fill="none"></path></g>
    <g><path d="M15,4V3H9v1H4v2h1v13c0,1.1,0.9,2,2,2h10c1.1,0,2-0.9,2-2V6h1V4H15z M11,17H9V8h2V17z M15,17h-2V8h2V17z"></path></g>
  </svg>
);

const SharedWithMeIcon = ({ fontSize = '24px' }: { fontSize?: string }) => (
  <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" fill="currentColor" focusable="false">
    <path d="M15 8c0-1.42-.5-2.73-1.33-3.76.42-.14.86-.24 1.33-.24 2.21 0 4 1.79 4 4s-1.79 4-4 4c-.43 0-.84-.09-1.23-.21-.03-.01-.06-.02-.1-.03A5.98 5.98 0 0 0 15 8zm1.66 5.13C18.03 14.06 19 15.32 19 17v3h4v-3c0-2.18-3.58-3.47-6.34-3.87zM9 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 9c-2.7 0-5.8 1.29-6 2.01V18h12v-1c-.2-.71-3.3-2-6-2M9 4c2.21 0 4 1.79 4 4s-1.79 4-4 4-4-1.79-4-4 1.79-4 4-4zm0 9c2.67 0 8 1.34 8 4v3H1v-3c0-2.66 5.33-4 8-4z"></path>
  </svg>
);

const MyDriveIcon = ({ fontSize = '24px' }: { fontSize?: string }) => (
  <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" fill="currentColor" focusable="false" style={{ display: 'block' }}>
    <path d="M9.05 15H15q.275 0 .5-.137.225-.138.35-.363l1.1-1.9q.125-.225.1-.5-.025-.275-.15-.5l-2.95-5.1q-.125-.225-.35-.363Q13.375 6 13.1 6h-2.2q-.275 0-.5.137-.225.138-.35.363L7.1 11.6q-.125.225-.125.5t.125.5l1.05 1.9q.125.25.375.375T9.05 15Zm1.2-3L12 9l1.75 3ZM3 17V4q0-.825.587-1.413Q4.175 2 5 2h14q.825 0 1.413.587Q21 3.175 21 4v13Zm2 5q-.825 0-1.413-.587Q3 20.825 3 20v-1h18v1q0 .825-.587 1.413Q19.825 22 19 22Z"></path>
  </svg>
);
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import type { DriveItem, DriveFolder } from '../lib/types';
import { sendMessage as originalSendMessage } from '../lib/messaging';
import FilePreview from './FilePreview';

// Debug helper function
const debugLog = (action: string, data?: any) => {
  console.log(`%c[Drive Browser Debug] ${action}`, 'background: #333; color: #bada55', data || '');
};

// Enhanced sendMessage with debug logging
function sendMessage<T>(message: any): Promise<T> {
  debugLog(`API REQUEST: ${message.type}`, message.payload);
  return originalSendMessage<T>(message)
    .then((result) => {
      debugLog(`API RESPONSE: ${message.type}`, result);
      return result;
    })
    .catch((error) => {
      debugLog(`API ERROR: ${message.type}`, error);
      throw error;
    });
}

interface DriveFileBrowserProps {
  onStorageUpdate?: () => void; // Callback to refresh storage display
}

// BlobPart is a union type that includes various types accepted by the Blob constructor
// It includes ArrayBuffer, ArrayBufferView, Blob, and string
type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob;

// Helper function to directly update storage quota
async function refreshStorageQuota(): Promise<void> {
  console.log('[DriveFileBrowser] Directly refreshing storage quota');
  try {
    // First attempt
    await sendMessage({ type: 'GET_STORAGE_QUOTA' });
    console.log('[DriveFileBrowser] Storage quota refreshed directly');
    
    // Wait a moment and refresh again to ensure most recent data
    await new Promise(resolve => setTimeout(resolve, 500));
    await sendMessage({ type: 'GET_STORAGE_QUOTA' });
    console.log('[DriveFileBrowser] Storage quota refreshed again after delay');
  } catch (err) {
    console.error('[DriveFileBrowser] Error refreshing storage quota:', err);
  }
}

// Dedicated function to handle emptying trash with proper storage updates
async function handleEmptyTrashOperation({
  setLoading, 
  setSuccess, 
  setError, 
  loadTrash, 
  setEmptyTrashConfirmOpen,
  onStorageUpdate,
  setEmptyTrashProgress
}: {
  setLoading: (loading: boolean) => void;
  setSuccess: (message: string) => void;
  setError: (error: string | null) => void;
  loadTrash: () => Promise<void>;
  setEmptyTrashConfirmOpen: (open: boolean) => void;
  onStorageUpdate?: () => void;
  setEmptyTrashProgress: (progress: any) => void;
}) {
  try {
    // Close the confirmation dialog
    setEmptyTrashConfirmOpen(false);
    
    // Use the new progress-tracking empty trash operation
    console.log('[EmptyTrash] Sending EMPTY_TRASH_WITH_PROGRESS message');
    await sendMessage({ type: 'EMPTY_TRASH_WITH_PROGRESS' });
    console.log('[EmptyTrash] Successfully emptied trash with progress');
    
    // Refresh trash list UI after a delay to ensure all items are gone
    setTimeout(async () => {
      await loadTrash();
      setSuccess('Trash emptied successfully');
    }, 1000);
    
    // Update storage display using our direct method
    console.log('[EmptyTrash] Directly refreshing storage quota after empty trash');
    await refreshStorageQuota();
    
    // Also trigger the callback if available, with delay to ensure
    // API responses have been processed
    if (onStorageUpdate) {
      console.log('[EmptyTrash] Triggering onStorageUpdate callback after delay');
      
      // First call the callback immediately
      onStorageUpdate();
      console.log('[EmptyTrash] First onStorageUpdate callback complete');
      
      // Then wait 1 second and call it again to ensure UI reflects latest data
      setTimeout(() => {
        console.log('[EmptyTrash] Triggering delayed onStorageUpdate callback');
        onStorageUpdate();
        console.log('[EmptyTrash] Delayed onStorageUpdate callback complete');
      }, 1000);
    } else {
      console.log('[EmptyTrash] No onStorageUpdate callback available');
    }
  } catch (error: any) {
    console.error('[EmptyTrash] Error emptying trash:', error);
    setError(`Failed to empty trash: ${error.message}`);
  } finally {
    setLoading(false);
  }
}

export default function DriveFileBrowser({ onStorageUpdate }: DriveFileBrowserProps = {} as DriveFileBrowserProps) {
  // Listen for progress updates from service worker
  useEffect(() => {
    const messageListener = (message: any) => {
      // Handle copy progress updates
      if (message.type === 'COPY_FILE_PROGRESS') {
        const data = message.payload;
        debugLog('Received copy progress update:', data);
        
        setCopyProgress(prev => ({
          ...prev,
          visible: true,
          percentComplete: data.percentComplete,
          bytesTransferred: data.bytesTransferred,
          totalBytes: data.totalBytes,
          lastUpdateTime: Date.now()
        }));
      }
      
      // Handle trash emptying progress updates
      else if (message.type === 'EMPTY_TRASH_PROGRESS_UPDATE') {
        const data = message.payload;
        debugLog('Received trash emptying progress update:', data);
        
        setEmptyTrashProgress({
          visible: true,
          status: data.status,
          percentComplete: data.percentComplete,
          totalItems: data.totalItems,
          itemsRemaining: data.itemsRemaining,
          currentFile: data.currentFile,
          deleteSpeed: data.deleteSpeed,
          remainingSizeBytes: data.remainingSizeBytes
        });
        
        // When operation completes, schedule hiding the progress dialog
        if (data.status === 'completed') {
          setTimeout(() => {
            setEmptyTrashProgress(prev => ({ ...prev, visible: false }));
          }, 3000);
        }
      }
      
      // Handle download progress updates
      else if (message.type === 'DOWNLOAD_PROGRESS_UPDATE') {
        const data = message.payload;
        debugLog('Received download progress update:', data);
        
        // Update progress display - ensure we use the latest data
        // but preserve UI state like visibility
        setDownloadProgress(prev => {
          // Make sure we don't go backwards in progress
          const percentComplete = Math.max(prev.percentComplete || 0, data.percentComplete || 0);
          
          // Show dialog for new downloads, otherwise preserve current visibility
          const isNewDownload = !prev.downloadId || prev.downloadId !== data.downloadId;
          
          return {
            ...data,
            visible: isNewDownload ? true : prev.visible, // Preserve current visible state
            percentComplete,
            // Preserve these UI state values
            isPaused: data.isPaused !== undefined ? data.isPaused : prev.isPaused,
            isCancelled: data.isCancelled !== undefined ? data.isCancelled : prev.isCancelled
          };
        });
      }
    };
    
    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Refresh data when active account changes
  useEffect(() => {
    debugLog('Account changed, refreshing data');
    
    // Reset any errors when switching accounts
    setError(null);
  }, [onStorageUpdate]);
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [items, setItems] = useState<DriveItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'My Drive' }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewingTrash, setViewingTrash] = useState(false);
  const [viewingSharedWithMe, setViewingSharedWithMe] = useState(false);
  const [cameFromSharedWithMe, setCameFromSharedWithMe] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<DriveItem[]>([]);
  const [lastSearchParams, setLastSearchParams] = useState<SearchParams | null>(null);
  
  // Track known verified shared folders by ID
  const [knownSharedFolderIds] = useState<Set<string>>(new Set());
  
  // Menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedItem, setSelectedItem] = useState<DriveItem | null>(null);
  const [activeItem, setActiveItem] = useState<DriveItem | null>(null);
  
  // Dialog states
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  const [permanentDeleteConfirmOpen, setPermanentDeleteConfirmOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    fileId: string;
    fileName: string;
    fileUrl?: string;
    mimeType?: string;
    size?: number | null;
    modifiedTime?: string | null;
    thumbnailLink?: string | null;
    webViewLink?: string | null;
    owners?: any[];
  } | null>(null);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  
  // Form states
  const [newName, setNewName] = useState('');
  const [moveTargetFolder, setMoveTargetFolder] = useState('');
  const [availableFolders, setAvailableFolders] = useState<DriveFolder[]>([]);
  
  // Copy feature states
  const [copyDestinationAccount, setCopyDestinationAccount] = useState('');
  const [copyDestinationFolder, setCopyDestinationFolder] = useState('root');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [destinationFolders, setDestinationFolders] = useState<DriveFolder[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string>('');
  const [copyProgress, setCopyProgress] = useState<{
    visible: boolean;
    percentComplete: number;
    bytesTransferred: number;
    totalBytes: number;
    fileName: string;
    destinationFolderName: string;
    fileId?: string;
    lastUpdateTime?: number;
  }>({
    visible: false,
    percentComplete: 0,
    bytesTransferred: 0,
    totalBytes: 0,
    fileName: '',
    destinationFolderName: '',
    fileId: undefined,
    lastUpdateTime: undefined
  });
  
  // Progress tracking for downloads and batch operations
  const [downloadProgress, setDownloadProgress] = useState<{
    visible: boolean;
    status: 'downloading' | 'completed' | 'error';
    percentComplete: number;
    filename: string;
    fileSize: string;
    downloadedBytes: number;
    totalBytes: number;
    transferRate: number; // KB/sec
    timeRemaining: number; // seconds
    chunks: Array<{id: number, progress: number, size: number, downloaded: number}>;
    downloadId?: string;
    isPaused?: boolean;
    isCancelled?: boolean;
    lastUpdateTime?: number;
  }>({ 
    visible: false, 
    status: 'downloading',
    percentComplete: 0,
    filename: '',
    fileSize: '0',
    downloadedBytes: 0,
    totalBytes: 0,
    transferRate: 0,
    timeRemaining: 0,
    chunks: []
  });
  
  // State for showing/hiding download details
  const [showDownloadDetails, setShowDownloadDetails] = useState(true);
  
  // Multi-selection states
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  
  // Zip progress state
  const [zipProgress, setZipProgress] = useState<{
    visible: boolean;
    filesCount: number;
    currentFile: number;
    currentFileName: string;
  }>({
    visible: false,
    filesCount: 0,
    currentFile: 0,
    currentFileName: ''
  });
  
  // View mode state (list or grid) - default to list
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  
  // Load saved view mode from storage on mount
  useEffect(() => {
    chrome.storage.local.get(['viewMode'], (result) => {
      if (result.viewMode === 'grid' || result.viewMode === 'list') {
        setViewMode(result.viewMode);
      }
    });
  }, []);
  
  // Save view mode to storage when it changes
  const handleViewModeChange = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    chrome.storage.local.set({ viewMode: mode });
  };
  
  // Legacy progress state (keeping for compatibility)
  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  
  // Trash emptying progress tracking
  const [emptyTrashProgress, setEmptyTrashProgress] = useState<{
    visible: boolean;
    status: 'deleting' | 'completed';
    percentComplete: number;
    totalItems: number;
    itemsRemaining: number;
    currentFile: string;
    deleteSpeed: number; // items per second
    remainingSizeBytes: number;
  }>({ 
    visible: false, 
    status: 'deleting',
    percentComplete: 0,
    totalItems: 0,
    itemsRemaining: 0,
    currentFile: '',
    deleteSpeed: 0,
    remainingSizeBytes: 0
  });

  // Load saved navigation state on mount
  useEffect(() => {
    const loadSavedNavigation = async () => {
      try {
        const result = await chrome.storage.local.get(['lastVisitedFolder', 'preferences']);
        const currentAccountId = result.preferences?.defaultAccountId;
        
        if (result.lastVisitedFolder && currentAccountId) {
          const { folderId, breadcrumbs: savedBreadcrumbs, accountId: savedAccountId } = result.lastVisitedFolder;
          
          // Check if the saved navigation belongs to the current account
          if (savedAccountId === currentAccountId && folderId && savedBreadcrumbs) {
            debugLog('Restoring last visited folder', { folderId, breadcrumbs: savedBreadcrumbs });
            setBreadcrumbs(savedBreadcrumbs);
            setCurrentFolderId(folderId);
            return;
          } else if (savedAccountId !== currentAccountId) {
            // Account has changed - reset to root folder
            debugLog('Account changed, resetting to root folder', { savedAccountId, currentAccountId });
            await chrome.storage.local.remove('lastVisitedFolder');
            setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
            setCurrentFolderId('root');
            return;
          }
        }
      } catch (error) {
        debugLog('Error loading saved navigation', error);
      }
    };
    
    loadSavedNavigation();
  }, []); // Run once on mount

  // Load folder contents when id changes
  useEffect(() => {
    if (viewingTrash) {
      loadTrash();
    } else if (viewingSharedWithMe) {
      // Don't load folder contents when viewing shared with me
      // SharedWithMeView component handles its own data loading
    } else {
      loadFolderContents(currentFolderId);
    }
  }, [currentFolderId, viewingTrash, viewingSharedWithMe]);

  // Save navigation state whenever folder or breadcrumbs change
  useEffect(() => {
    if (!viewingTrash && !viewingSharedWithMe && currentFolderId && currentAccountId) {
      chrome.storage.local.set({
        lastVisitedFolder: {
          folderId: currentFolderId,
          breadcrumbs: breadcrumbs,
          accountId: currentAccountId
        }
      }).catch(error => {
        debugLog('Error saving navigation state', error);
      });
    }
  }, [currentFolderId, breadcrumbs, viewingTrash, currentAccountId]);

  const handleTrashToggle = () => {
    setViewingTrash(!viewingTrash);
  };
  
  const handleItemClick = (item: DriveItem) => {
    if (item.isFolder) {
      // Exit search mode if in search
      if (searchMode) {
        setSearchMode(false);
        setSearchResults([]);
        setLastSearchParams(null);
        setBreadcrumbs([{ id: 'root', name: 'My Drive' }, { id: item.id, name: item.name }]);
      } else {
        // Navigate to the clicked folder
        setBreadcrumbs([...breadcrumbs, { id: item.id, name: item.name }]);
      }
      setCurrentFolderId(item.id);
    } else {
      // Preview file when clicked
      debugLog('Item clicked - opening preview', item);
      setPreviewFile({
        fileId: item.id,
        fileName: item.name,
        fileUrl: `https://drive.google.com/file/d/${item.id}/view`,
        mimeType: item.mimeType,
        size: item.size,
        modifiedTime: item.modifiedTime,
        thumbnailLink: item.thumbnailLink,
        webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
        owners: item.owners,
      });
    }
  };

  const handleSharedItemClick = (item: any) => {
    if (item.isFolder) {
      // Exit "Shared with me" view and navigate to the folder
      setViewingSharedWithMe(false);
      setCameFromSharedWithMe(true); // Mark that we came from Shared with me
      setBreadcrumbs([{ id: 'root', name: 'My Drive' }, { id: item.id, name: item.name }]);
      setCurrentFolderId(item.id);
    } else {
      // Preview file when clicked
      debugLog('Shared item clicked - opening preview', item);
      setPreviewFile({
        fileId: item.id,
        fileName: item.name,
        fileUrl: `https://drive.google.com/file/d/${item.id}/view`,
        mimeType: item.mimeType,
        size: item.size,
        modifiedTime: item.modifiedTime,
        thumbnailLink: item.thumbnailLink,
        webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
        owners: item.owners,
      });
    }
  };

  const handleBackToSharedWithMe = () => {
    setViewingSharedWithMe(true);
    setCameFromSharedWithMe(false);
    setBreadcrumbs([{ id: 'root', name: 'My Drive' }]);
    setCurrentFolderId('root');
  };
  
  const handleBreadcrumbClick = (index: number) => {
    const newPath = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newPath);
    setCurrentFolderId(newPath[newPath.length - 1].id);
    // Reset the "came from shared with me" flag when navigating via breadcrumbs
    if (cameFromSharedWithMe) {
      setCameFromSharedWithMe(false);
    }
  };
  
  const loadFolderContents = async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      console.log(`Loading contents for folder: ${folderId}`);
      const contents = await sendMessage<DriveItem[]>({
        type: 'LIST_FOLDER_CONTENTS',
        payload: { folderId }
      });
      
      if (!contents || contents.length === 0) {
        console.log('No items found in folder');
        setItems([]);
      } else {
        console.log(`Received ${contents.length} items from Drive API`);
        
        // Log existing shared items first
        const originalShared = contents.filter(item => item.sharedWithMe);
        if (originalShared.length > 0) {
          console.log('Original shared items from API:', 
            originalShared.map(item => ({ name: item.name, isFolder: item.isFolder })));
        }

        // Get truly shared items - only folders with explicit shared flag
        const validSharedItems = contents.filter(item => 
          item.isFolder && item.shared === true
        );

        // Update our set of known shared folder IDs
        validSharedItems.forEach(item => {
          if (!knownSharedFolderIds.has(item.id)) {
            console.log(`Adding verified shared folder to known list: ${item.name} (${item.id})`);
            knownSharedFolderIds.add(item.id);
          }
        });
        
        // Filter out falsely reported shared items (non-folders)
        // Track how many were filtered out for logging
        const falseSharedItems = contents.filter(item => 
          !item.isFolder && item.shared === true
        );

        if (falseSharedItems.length > 0) {
          console.log(`Filtered out ${falseSharedItems.length} non-folder items incorrectly marked as shared`);
        }
        
        // Just use the contents as-is, but with better logging
        const enhancedContents = [...contents];
        
        // Log shared items for debugging
        const sharedItems = enhancedContents.filter(item => item.shared);
        if (sharedItems.length > 0) {
          console.log(`Found ${sharedItems.length} shared items:`, 
            sharedItems.map(item => ({ name: item.name, isFolder: item.isFolder })));
        } else {
          console.log('No shared items found in this folder');
        }
        
        setItems(enhancedContents);
      }
    } catch (err: any) {
      console.error('Error in loadFolderContents:', err);
      let errorMsg = `Failed to load folder contents: ${err.message}`;
      if (err.message.includes('400')) {
        errorMsg += '. This might be due to an API limitation or permission issue.';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const loadTrash = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Loading trash items');
      const trashItems = await sendMessage<DriveItem[]>({ type: 'LIST_TRASH' });
      
      if (!trashItems || trashItems.length === 0) {
        console.log('No items found in trash');
        setItems([]);
      } else {
        console.log(`Received ${trashItems.length} trash items from Drive API`);
        
        // Log existing shared items first
        const originalShared = trashItems.filter(item => item.sharedWithMe);
        if (originalShared.length > 0) {
          console.log('Original shared items from trash API:', 
            originalShared.map(item => ({ name: item.name, isFolder: item.isFolder })));
        }
        
        // Get truly shared items in trash - only folders with explicit shared flag
        const validSharedTrashItems = trashItems.filter(item => 
          item.isFolder && item.shared === true
        );

        // Update our set of known shared folder IDs
        validSharedTrashItems.forEach(item => {
          if (!knownSharedFolderIds.has(item.id)) {
            console.log(`Adding verified shared folder from trash to known list: ${item.name} (${item.id})`);
            knownSharedFolderIds.add(item.id);
          }
        });
        
        // Filter out falsely reported shared items (non-folders)
        const falseTrashSharedItems = trashItems.filter(item => 
          !item.isFolder && item.shared === true
        );

        if (falseTrashSharedItems.length > 0) {
          console.log(`Filtered out ${falseTrashSharedItems.length} non-folder trash items incorrectly marked as shared`);
        }
        
        // Use the items as-is for display
        const enhancedTrashItems = [...trashItems];
        
        // Log shared items in trash for debugging
        const sharedItems = enhancedTrashItems.filter(item => item.shared);
        if (sharedItems.length > 0) {
          console.log(`Found ${sharedItems.length} shared items in trash:`, 
            sharedItems.map(item => ({ name: item.name, isFolder: item.isFolder })));
        } else {
          console.log('No shared items found in trash');
        }
        
        setItems(enhancedTrashItems);
      }
    } catch (err: any) {
      console.error('Error in loadTrash:', err);
      let errorMsg = `Failed to load trash: ${err.message}`;
      if (err.message.includes('400')) {
        errorMsg += '. This might be due to an API limitation or permission issue.';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Search handlers
  const handleSearch = async (searchParams: SearchParams) => {
    console.log('[DriveFileBrowser] Performing search:', searchParams);
    setLoading(true);
    setError(null);
    setSearchMode(true);
    setLastSearchParams(searchParams);
    
    try {
      const result = await sendMessage<{ files: DriveItem[] }>({
        type: 'SEARCH_DRIVE',
        payload: searchParams
      });
      
      console.log('[DriveFileBrowser] Search results:', result.files.length, 'files');
      setSearchResults(result.files || []);
      setItems(result.files || []);
    } catch (err: any) {
      console.error('[DriveFileBrowser] Search error:', err);
      setError(`Search failed: ${err.message}`);
      setSearchResults([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearSearch = () => {
    console.log('[DriveFileBrowser] Clearing search');
    setSearchMode(false);
    setSearchResults([]);
    setLastSearchParams(null);
    
    // Reload current view
    if (viewingTrash) {
      loadTrash();
    } else {
      loadFolderContents(currentFolderId);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, item: DriveItem) => {
    debugLog('Menu opened for item', { id: item.id, name: item.name, isFolder: item.isFolder });
    setMenuAnchor(event.currentTarget);
    setSelectedItem(item);
    setActiveItem(item); // Set active item that persists after menu close
    // Check if the item was properly set
    setTimeout(() => {
      debugLog('selectedItem after menu open', selectedItem);
    }, 10);
  };

  const handleMenuClose = () => {
    debugLog('Menu closed');
    setMenuAnchor(null);
    // Keep activeItem for operations but clear menu selection
    setSelectedItem(null);
  };

  // Load available folders for move operation
  const loadAvailableFolders = async () => {
    setLoading(true);
    try {
      const folders = await sendMessage<DriveFolder[]>({
        type: 'LIST_FOLDERS'
      });
      
      setAvailableFolders(folders.filter(folder => 
        // Don't include current folder or the item itself (if it's a folder)
        folder.id !== currentFolderId && 
        (!selectedItem || folder.id !== selectedItem.id)
      ));
    } catch (error: any) {
      setError(`Failed to load folders: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Move item handler
  const handleMoveItem = async () => {
    debugLog('Move item handler called');
    if (!activeItem) {
      debugLog('ERROR: No activeItem available for move operation');
      setError('No item selected to move');
      return;
    }
    if (!moveTargetFolder) {
      debugLog('ERROR: No destination folder selected');
      setError('No destination folder selected');
      return;
    }
    
    debugLog('Attempting to move item', { 
      item: activeItem.name,
      itemId: activeItem.id,
      destinationId: moveTargetFolder
    });
    
    try {
      const response = await sendMessage({
        type: 'MOVE_ITEM',
        payload: { 
          itemId: activeItem.id, 
          newParentId: moveTargetFolder 
        }
      });
      
      debugLog('Move response received', response);
      
      // Refresh the current folder
      loadFolderContents(currentFolderId);
      
      // Show success message
      const targetFolder = availableFolders.find(f => f.id === moveTargetFolder);
      const successMsg = `Moved "${activeItem.name}" to "${targetFolder?.name || 'destination folder'}"`;
      debugLog('Move success', successMsg);
      setSuccess(successMsg);
      setMoveDialogOpen(false);
      
      // Clear form data
      setMoveTargetFolder('');
      setActiveItem(null); // Clear the active item after successful operation
    } catch (error: any) {
      const errorMsg = `Failed to move item: ${error.message}`;
      debugLog('ERROR: Move failed', error);
      setError(errorMsg);
    }
  };

  const handleRenameItem = async () => {
    debugLog('Rename item handler called');
    if (!activeItem) {
      debugLog('ERROR: No activeItem available for rename operation');
      setError('No item selected to rename');
      return;
    }
    if (!newName) {
      debugLog('ERROR: No new name provided');
      setError('No new name provided');
      return;
    }
    
    debugLog('Attempting to rename item', { 
      item: activeItem.name,
      itemId: activeItem.id,
      newName: newName
    });
    
    try {
      const result = await sendMessage({
        type: 'RENAME_ITEM',
        payload: { itemId: activeItem.id, newName: newName }
      });
      
      debugLog('Rename response received', result);
      
      // Refresh the current folder
      loadFolderContents(currentFolderId);
      
      // Show success message
      const successMsg = `Renamed "${activeItem.name}" to "${newName}" successfully`;
      debugLog('Rename success', successMsg);
      setSuccess(successMsg);
      setRenameDialogOpen(false);
      
      // Clear form data
      setNewName('');
      setActiveItem(null); // Clear the active item after successful operation
    } catch (error: any) {
      const errorMsg = `Failed to rename: ${error.message}`;
      debugLog('ERROR: Rename failed', error);
      setError(errorMsg);
    }
  };

  const handleDeleteItem = async () => {
    debugLog('Delete item (move to trash) handler called');
    if (!activeItem) {
      debugLog('ERROR: No activeItem available for delete operation');
      setError('No item selected to delete');
      return;
    }
    
    debugLog('Attempting to move item to trash', { 
      item: activeItem.name,
      itemId: activeItem.id
    });
    
    try {
      const result = await sendMessage({
        type: 'DELETE_ITEM',
        payload: { itemId: activeItem.id }
      });
      
      debugLog('Delete response received', result);
      
      // Refresh the current folder
      loadFolderContents(currentFolderId);
      
      // Show success message
      const successMsg = `Moved "${activeItem.name}" to trash`;
      debugLog('Delete success', successMsg);
      setSuccess(successMsg);
      setDeleteConfirmOpen(false);
      setActiveItem(null); // Clear the active item after successful operation

      // Update storage display - both direct API refresh and UI callback
      debugLog('Updating storage display after trash operation');
      
      // First do direct API refresh to update quota on server side
      await refreshStorageQuota();
      
      // Then trigger UI update via callback if available
      if (onStorageUpdate) {
        try {
          debugLog('Calling onStorageUpdate callback');
          onStorageUpdate();
          debugLog('Storage update callback executed successfully');
        } catch (err) {
          debugLog('ERROR: Exception in onStorageUpdate', err);
        }
      } else {
        debugLog('WARNING: onStorageUpdate callback is not defined');
      }
    } catch (error: any) {
      const errorMsg = `Failed to move to trash: ${error.message}`;
      debugLog('ERROR: Delete failed', error);
      setError(errorMsg);
    }
  };

  const handleRestoreItem = async () => {
    debugLog('Restore item handler called');
    if (!activeItem) {
      debugLog('ERROR: No activeItem available for restore operation');
      setError('No item selected to restore');
      return;
    }
    
    debugLog('Attempting to restore item from trash', { 
      item: activeItem.name,
      itemId: activeItem.id
    });
    
    try {
      const result = await sendMessage({
        type: 'RESTORE_ITEM',
        payload: { itemId: activeItem.id }
      });
      
      debugLog('Restore response received', result);
      
      // Refresh trash
      loadTrash();
      
      // Show success message
      const successMsg = `Restored "${activeItem.name}" from trash`;
      debugLog('Restore success', successMsg);
      setSuccess(successMsg);
      setActiveItem(null); // Clear the active item after successful operation

      // Update storage display - both direct API refresh and UI callback
      debugLog('Updating storage display after restore operation');
      
      // First do direct API refresh to update quota on server side
      await refreshStorageQuota();
      
      // Then trigger UI update via callback if available
      if (onStorageUpdate) {
        try {
          debugLog('Calling onStorageUpdate callback');
          onStorageUpdate();
          debugLog('Storage update callback executed successfully');
        } catch (err) {
          debugLog('ERROR: Exception in onStorageUpdate', err);
        }
      } else {
        debugLog('WARNING: onStorageUpdate callback is not defined');
      }
    } catch (error: any) {
      const errorMsg = `Failed to restore: ${error.message}`;
      debugLog('ERROR: Restore failed', error);
      setError(errorMsg);
    }
  };

  const handlePermanentDelete = async () => {
    debugLog('Permanent delete handler called');
    if (!activeItem) {
      debugLog('ERROR: No activeItem available for permanent delete operation');
      setError('No item selected to permanently delete');
      return;
    }
    
    debugLog('Attempting to permanently delete item', { 
      item: activeItem.name,
      itemId: activeItem.id
    });
    
    try {
      const result = await sendMessage({
        type: 'PERMANENTLY_DELETE_ITEM',
        payload: { itemId: activeItem.id }
      });
      
      debugLog('Permanent delete response received', result);
      
      // Refresh trash
      loadTrash();
      
      // Show success message
      const successMsg = `Permanently deleted "${activeItem.name}"`;
      debugLog('Permanent delete success', successMsg);
      setSuccess(successMsg);
      setPermanentDeleteConfirmOpen(false);
      setActiveItem(null); // Clear the active item after successful operation

      // Update storage display - both direct API refresh and UI callback
      debugLog('Updating storage display after permanent delete operation');
      
      // First do direct API refresh to update quota on server side
      await refreshStorageQuota();
      
      // Then trigger UI update via callback if available
      if (onStorageUpdate) {
        try {
          debugLog('Calling onStorageUpdate callback');
          onStorageUpdate(); // First immediate update
          
          // Second delayed update to ensure latest data is shown
          setTimeout(() => {
            debugLog('Calling delayed onStorageUpdate callback');
            onStorageUpdate();
          }, 1000);
          
          debugLog('Storage update callback executed successfully');
        } catch (err) {
          debugLog('ERROR: Exception in onStorageUpdate', err);
        }
      } else {
        debugLog('WARNING: onStorageUpdate callback is not defined');
      }
    } catch (error: any) {
      const errorMsg = `Failed to permanently delete: ${error.message}`;
      debugLog('ERROR: Permanent delete failed', error);
      setError(errorMsg);
    }
  };

  // Effect to load active downloads from storage when popup opens
  useEffect(() => {
    // Check for active downloads when component mounts (popup opens)
    const loadActiveDownloads = async () => {
      try {
        // Get active download from storage
        const result = await new Promise<{activeDownload?: any}>((resolve) => {
          chrome.storage.local.get('activeDownload', (result) => {
            resolve(result as {activeDownload?: any});
          });
        });
        
        if (result.activeDownload) {
          debugLog('Found active download in storage', result.activeDownload);
          console.log('[UI] Initial load - Full data:', {
            status: result.activeDownload.status,
            fileSize: result.activeDownload.fileSize,
            totalBytes: result.activeDownload.totalBytes,
            downloadedBytes: result.activeDownload.downloadedBytes,
            percentComplete: result.activeDownload.percentComplete,
            chunks: result.activeDownload.chunks?.length || 0
          });
          
          // Check if download is still in progress or paused - we should show these
          const isActiveDownload = (
            result.activeDownload.status === 'downloading' && 
            !result.activeDownload.isCancelled
          );
          
          // If there's an active download, show the progress dialog
          setDownloadProgress({
            ...result.activeDownload,
            visible: isActiveDownload // Only show active downloads automatically
          });
          
          // If download is active, make a service worker call to sync state
          if (result.activeDownload.downloadId) {
            try {
              const syncResult = await sendMessage<{exists: boolean, status?: string, isPaused?: boolean}>({ 
                type: 'SYNC_DOWNLOAD_STATUS', 
                payload: { downloadId: result.activeDownload.downloadId } 
              });
              
              debugLog(`Download sync result: ${JSON.stringify(syncResult)}`);
              
              // If download doesn't exist in service worker but we have it in storage,
              // update the UI with the correct status
              if (!syncResult.exists) {
                debugLog('Download no longer exists in service worker, updating UI');
                if (isActiveDownload) {
                  // Update download to show it's completed (preserve all existing data)
                  setDownloadProgress(prev => {
                    // Only update if not already at 100%
                    if (prev.percentComplete < 100) {
                      return {
                        ...prev,
                        status: 'completed',
                        percentComplete: 100,
                        downloadedBytes: prev.totalBytes || prev.downloadedBytes,
                        transferRate: 0
                      };
                    }
                    return prev;
                  });
                }
              } else {
                // Update with the latest status from service worker
                setDownloadProgress(prev => {
                  // Ensure status is one of the allowed values
                  const validStatus = (
                    syncResult.status === 'downloading' || 
                    syncResult.status === 'completed' || 
                    syncResult.status === 'error'
                  ) ? syncResult.status : prev.status;
                  
                  return {
                    ...prev,
                    status: validStatus,
                    isPaused: syncResult.isPaused !== undefined ? syncResult.isPaused : prev.isPaused
                  };
                });
              }
            } catch (syncError) {
              debugLog('Error syncing download status', syncError);
              // Don't show error to user, just keep the UI state as is
            }
          }
        }
      } catch (error) {
        debugLog('Error loading active downloads', error);
      }
    };
    
    loadActiveDownloads();
    
    // Listen for storage changes to keep copy state in sync
    const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.activeCopyOperation) {
        const copyOp = changes.activeCopyOperation.newValue;
        
        if (copyOp && copyOp.status === 'copying') {
          debugLog('Copy operation updated from storage:', copyOp);
          setCopyProgress({
            visible: true,
            percentComplete: copyOp.percentComplete || 0,
            bytesTransferred: copyOp.bytesTransferred || 0,
            totalBytes: copyOp.totalBytes || 0,
            fileName: copyOp.fileName || 'File',
            destinationFolderName: copyOp.destinationFolderName || 'destination',
            fileId: copyOp.fileId,
            lastUpdateTime: Date.now()
          });
        } else if (!copyOp) {
          // Copy operation was removed (completed, failed, or cancelled)
          // Close the dialog immediately
          setCopyProgress({
            visible: false,
            percentComplete: 0,
            bytesTransferred: 0,
            totalBytes: 0,
            fileName: '',
            destinationFolderName: '',
            fileId: undefined,
            lastUpdateTime: undefined
          });
        }
      }
      
      if (area === 'local' && changes.activeDownload) {
        const newValue = changes.activeDownload.newValue;
        const oldValue = changes.activeDownload.oldValue;
        
        if (newValue) {
          debugLog('Download progress updated from storage', newValue);
          console.log('[UI] Storage update - Full data:', {
            status: newValue.status,
            fileSize: newValue.fileSize,
            totalBytes: newValue.totalBytes,
            downloadedBytes: newValue.downloadedBytes,
            percentComplete: newValue.percentComplete,
            chunks: newValue.chunks?.length || 0
          });
          
          // Preserve UI state between updates
          setDownloadProgress(prev => {
            // Determine if dialog should be visible
            const isNewDownload = !oldValue || (oldValue.fileId !== newValue.fileId);
            const shouldBeVisible = isNewDownload ? true : prev.visible; // Preserve current visibility
            
            const updatedProgress = {
              ...newValue,
              visible: shouldBeVisible, // Always preserve current visible state
              // Special handling for pause/cancel state to ensure UI consistency
              isPaused: newValue.isPaused !== undefined ? newValue.isPaused : prev.isPaused,
              isCancelled: newValue.isCancelled !== undefined ? newValue.isCancelled : prev.isCancelled,
              // Ensure chunks info is properly updated
              chunks: Array.isArray(newValue.chunks) && newValue.chunks.length > 0 ? 
                newValue.chunks : prev.chunks || []
            };
            
            return updatedProgress;
          });
        } else {
          // Download was removed from storage - only hide if user didn't manually keep it visible
          setDownloadProgress(prev => ({ ...prev, visible: false }));
        }
      }
    };
    
    chrome.storage.onChanged.addListener(storageListener);
    
    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);
  
  // Load current account ID on mount
  useEffect(() => {
    const loadCurrentAccount = async () => {
      try {
        const { driveAccounts = [], preferences } = await chrome.storage.local.get(['driveAccounts', 'preferences']);
        
        if (preferences?.defaultAccountId) {
          setCurrentAccountId(preferences.defaultAccountId);
        } else if (driveAccounts.length > 0) {
          // Use first account if no default is set
          setCurrentAccountId(driveAccounts[0].id);
        }
      } catch (error) {
        debugLog('Error loading current account', error);
      }
    };
    
    loadCurrentAccount();
  }, []);
  
  // Restore active copy operation on mount (only if still in progress and recent)
  useEffect(() => {
    const restoreCopyState = async () => {
      try {
        const { activeCopyOperation } = await chrome.storage.local.get('activeCopyOperation');
        
        // Check if operation is stale (started more than 5 minutes ago)
        const isStale = activeCopyOperation && 
          activeCopyOperation.startedAt && 
          (Date.now() - activeCopyOperation.startedAt) > 5 * 60 * 1000;
        
        if (isStale) {
          debugLog('Removing stale copy operation');
          await chrome.storage.local.remove('activeCopyOperation');
          return;
        }
        
        // Only restore if the operation is still active, not at 100%, and recent
        if (activeCopyOperation && 
            activeCopyOperation.status === 'copying' && 
            activeCopyOperation.percentComplete < 100) {
          debugLog('Restoring active copy operation:', activeCopyOperation);
          
          // Restore the copy progress state
          setCopyProgress({
            visible: true,
            percentComplete: activeCopyOperation.percentComplete || 0,
            bytesTransferred: activeCopyOperation.bytesTransferred || 0,
            totalBytes: activeCopyOperation.totalBytes || 0,
            fileName: activeCopyOperation.fileName || 'File',
            destinationFolderName: activeCopyOperation.destinationFolderName || 'destination',
            fileId: activeCopyOperation.fileId,
            lastUpdateTime: Date.now()
          });
        } else if (activeCopyOperation) {
          // Clear completed/cancelled operations
          debugLog('Clearing completed/cancelled copy operation');
          await chrome.storage.local.remove('activeCopyOperation');
        }
      } catch (error) {
        debugLog('Error restoring copy state', error);
      }
    };
    
    restoreCopyState();
  }, []);
  
  // Auto-close copy dialog if no updates for 5 minutes (large files can take time during initial download)
  useEffect(() => {
    if (!copyProgress.visible || copyProgress.percentComplete >= 100) {
      return;
    }
    
    // Only start timeout if we've received at least one progress update
    // This prevents false timeouts during the initial "Preparing..." phase
    if (!copyProgress.lastUpdateTime || copyProgress.bytesTransferred === 0) {
      return;
    }
    
    const timeoutId = setTimeout(async () => {
      debugLog('Copy progress stale - no updates for 5 minutes, closing dialog');
      await chrome.storage.local.remove('activeCopyOperation');
      setCopyProgress({
        visible: false,
        percentComplete: 0,
        bytesTransferred: 0,
        totalBytes: 0,
        fileName: '',
        destinationFolderName: '',
        fileId: undefined,
        lastUpdateTime: undefined
      });
    }, 5 * 60 * 1000); // 5 minutes
    
    return () => clearTimeout(timeoutId);
  }, [copyProgress.visible, copyProgress.lastUpdateTime, copyProgress.percentComplete, copyProgress.bytesTransferred]);
  
  // Fetch accounts when the copy dialog opens
  useEffect(() => {
    if (copyDialogOpen) {
      const fetchAccounts = async () => {
        try {
          const response = await sendMessage<any[]>({ type: 'GET_ACCOUNTS' });
          // Filter out the current account from the list of destinations
          const filteredAccounts = response.filter((acc: any) => acc.id !== currentAccountId);
          setAccounts(filteredAccounts);
        } catch (error) {
          debugLog('Error fetching accounts', error);
          setError('Failed to load accounts');
        }
      };
      
      fetchAccounts();
    }
  }, [copyDialogOpen, currentAccountId]);
  
  // Fetch folders when the destination account changes
  useEffect(() => {
    if (copyDestinationAccount) {
      const fetchDestinationFolders = async () => {
        try {
          const folders = await sendMessage<DriveFolder[]>({
            type: 'LIST_FOLDERS_FOR_ACCOUNT',
            payload: { accountId: copyDestinationAccount }
          });
          setDestinationFolders(folders);
        } catch (error) {
          debugLog('Error fetching destination folders', error);
          setError('Failed to load folders for destination account');
        }
      };
      
      fetchDestinationFolders();
    }
  }, [copyDestinationAccount]);
  
  // Helper to save download progress to storage
  const saveDownloadProgress = (progress: any) => {
    try {
      // Save to local storage so other instances can access
      chrome.storage.local.set({ activeDownload: progress });
    } catch (error) {
      debugLog('Error saving download progress', error);
    }
  };
  
  // Function to show/hide the download dialog (can be called from menu)
  const toggleDownloadDialog = async () => {
    try {
      const result = await new Promise<{activeDownload?: any}>((resolve) => {
        chrome.storage.local.get('activeDownload', (result) => {
          resolve(result as {activeDownload?: any});
        });
      });
      
      // Only show if there's an active download that is not cancelled or completed
      if (result.activeDownload && 
          result.activeDownload.status === 'downloading' && 
          !result.activeDownload.isCancelled) {
        setDownloadProgress(prev => ({ 
          ...result.activeDownload, 
          visible: !prev.visible 
        }));
      }
    } catch (error) {
      debugLog('Error toggling download dialog', error);
    }
  };
  
  // Separate function to show download dialog immediately
  const startDownload = (item: DriveItem) => {
    debugLog('Starting download process', { item: item.name, id: item.id });
    
    // Show download progress dialog immediately with initial state
    const totalSizeBytes = item.size || 0;
    const fileSize = totalSizeBytes > 0 ? (totalSizeBytes / (1024 * 1024)).toFixed(2) + ' MB' : 'Unknown';
    
    // Create progress object
    const progressData = {
      visible: true,
      status: 'downloading' as 'downloading' | 'completed' | 'error',
      percentComplete: 0,
      filename: item.name,
      fileSize,
      downloadedBytes: 0,
      totalBytes: totalSizeBytes,
      transferRate: 0, 
      timeRemaining: 0,
      chunks: [{ id: 0, progress: 0, size: totalSizeBytes, downloaded: 0 }],
      startTime: Date.now(),
      fileId: item.id
    };
    
    // Update both local state and storage
    setDownloadProgress(progressData);
    saveDownloadProgress(progressData);
    
    // Stop loading indicator since we're showing specific download progress
    setLoading(false);
  };
  
  const handleDownloadItem = async () => {
    debugLog('Download item handler called');
    if (!activeItem || !activeItem.id) {
      debugLog('ERROR: No activeItem available for download operation');
      setError('No item selected to download');
      return;
    }
    
    if (activeItem.isFolder) {
      debugLog('ERROR: Cannot download folders directly');
      setError('Folders cannot be downloaded directly');
      return;
    }
    
    debugLog('Attempting to download item', { 
      item: activeItem.name,
      itemId: activeItem.id,
      mimeType: activeItem.mimeType
    });
    
    // Show download dialog immediately - this happens synchronously before any async operations
    startDownload(activeItem);

    // These variables need to be in scope for the entire function
    let blob: Blob | undefined = undefined;
    let filename = '';
    let type = '';
    let downloadedBytes = 0;
    let chunkBlobs: Uint8Array[] = [];
    let totalSizeBytesLocal = 0; // Store file size from activeItem
    
    // This forces the UI to update before proceeding with the heavy download operation
    setTimeout(async () => {
      try {
        // Main download operation within setTimeout
        debugLog('Requesting secure download for the current account');
        
        // Request the file download from the service worker
        const result = await sendMessage<
          { base64Data: string, filename: string, type: string } | 
          { downloadId: string, totalChunks: number, filename: string, type: string }
        >({
          type: 'DOWNLOAD_FILE',
          payload: { fileId: activeItem.id }
        });
      
        if (!result || !('filename' in result)) {
          throw new Error('Received invalid response from service worker');
        }
        
        filename = result.filename;
        type = result.type;
      
        // Check if we're dealing with a chunked download or direct download
        if ('base64Data' in result) {
          // Small file - direct download
          debugLog('Received small file directly, processing...', { 
            filename,
            type
          });
          
          // Get file size information
          const totalSizeBytes = activeItem.size || 0;
          const totalSizeMB = totalSizeBytes > 0 ? (totalSizeBytes / (1024 * 1024)).toFixed(2) : 'unknown';
        
          // Show detailed download progress dialog for small files too
          setDownloadProgress({
            visible: true,
            status: 'downloading',
            percentComplete: 0,
            filename,
            fileSize: `${totalSizeMB} MB`,
            downloadedBytes: 0,
            totalBytes: totalSizeBytes,
            transferRate: 0,
            timeRemaining: 0,
            chunks: [{ id: 0, progress: 0, size: totalSizeBytes, downloaded: 0 }]
          });
        
          // Convert base64 back to a Blob
          const base64Data = result.base64Data;
          const byteCharacters = atob(base64Data);
          const byteArrays = [];
          
          // Simulate progress updates for small files
          const totalBytes = byteCharacters.length;
          let processedBytes = 0;
          const chunkSize = Math.ceil(totalBytes / 10); // Process in 10 visual chunks
          const startTime = Date.now();
          
          for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              byteNumbers[i] = slice.charCodeAt(i);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
          
            // Update progress every chunk
            processedBytes += slice.length;
            const progress = Math.round((processedBytes / totalBytes) * 100);
            
            // Only update UI every few chunks to avoid excessive rerenders
            if (offset % chunkSize < 512) {
              const elapsedTime = (Date.now() - startTime) / 1000;
              const transferRate = elapsedTime > 0 ? Math.round((processedBytes / elapsedTime) / 1024) : 0;
                const remainingBytes = totalBytes - processedBytes;
              const timeRemaining = transferRate > 0 ? Math.ceil(remainingBytes / (transferRate * 1024)) : 0;
              
              // Update progress displays
              const downloadedMB = (processedBytes / (1024 * 1024)).toFixed(2);
              setProgressMessage(`Downloading ${filename} (${downloadedMB} MB / ${totalSizeMB} MB) - ${progress}%`);
              setProgress(progress);
              
              // Update detailed progress
              setDownloadProgress(prev => ({
                ...prev,
                percentComplete: progress,
                downloadedBytes: processedBytes,
                transferRate,
                timeRemaining,
                chunks: [{ id: 0, progress, size: totalBytes, downloaded: processedBytes }]
              }));
            }
          }
          
          blob = new Blob(byteArrays as any, {type: type || 'application/octet-stream'});
        
          // Mark download as complete
          const smallFileCompleteProgress = {
            ...downloadProgress,
            status: 'completed' as 'downloading' | 'completed' | 'error',
            percentComplete: 100,
            downloadedBytes: totalBytes,
            transferRate: 0,
            timeRemaining: 0,
            chunks: [{ id: 0, progress: 100, size: totalBytes, downloaded: totalBytes }],
            completedTime: Date.now()
          };
          
          setDownloadProgress(smallFileCompleteProgress);
          saveDownloadProgress(smallFileCompleteProgress);
      } else {
        // Large file - chunked download
        const { downloadId, totalChunks } = result;
        debugLog(`Processing large file with ${totalChunks} chunks`, { filename, type, downloadId });
        
        // Get the total file size from activeItem if available
        const totalSizeBytesLocal = activeItem?.size || 0;
        // Use the downloadedBytes variable from the outer scope
        downloadedBytes = 0;
        
        // Calculate MB values for display
        const totalSizeMB = totalSizeBytesLocal > 0 ? (totalSizeBytesLocal / (1024 * 1024)).toFixed(2) : 'unknown';
        
        // Initialize chunk progress tracking
        const chunks = Array(totalChunks).fill(null).map((_, idx) => ({
          id: idx,
          progress: 0,
          size: Math.floor(totalSizeBytesLocal / totalChunks),
          downloaded: 0
        }));
        
        // Initialize download time tracking
        const startTime = Date.now();
        let lastUpdateTime = startTime;
        let lastDownloadedBytes = 0;
        let transferRate = 0;
        
        // Update existing download dialog with chunk information
        setDownloadProgress(prev => ({
          ...prev,
          filename,
          // Preserve fileSize from service worker, only set if missing
          fileSize: prev.fileSize || `${totalSizeMB} MB`,
          // Preserve totalBytes from service worker, only set if missing
          totalBytes: prev.totalBytes || totalSizeBytesLocal,
          chunks
        }));
        
        // For backward compatibility
        setProgress(0);
        setProgressVisible(true);
        setProgressMessage(`Downloading ${filename} (0 MB / ${totalSizeMB} MB)`);
        
        // Use the chunkBlobs array declared at function scope
        
        for (let i = 0; i < totalChunks; i++) {
          let chunkResult: { chunk: string, isLastChunk: boolean } | null = null;
          
          try {
            // Show progress animation before starting fetch
            // This makes the UI feel more responsive even before we get data
            setDownloadProgress(prev => ({
              ...prev,
              percentComplete: Math.round(((i + 0.1) / totalChunks) * 100)
            }));
            
            // Fetch this chunk
            chunkResult = await sendMessage<{ chunk: string, isLastChunk: boolean }>({
              type: 'GET_DOWNLOAD_CHUNK',
              payload: { downloadId, chunkIndex: i }
            });
            
            // Show a mid-download progress update
            setDownloadProgress(prev => ({
              ...prev,
              percentComplete: Math.round(((i + 0.5) / totalChunks) * 100)
            }));
            
            if (!chunkResult || !chunkResult.chunk) {
              throw new Error(`Failed to retrieve chunk ${i}/${totalChunks}`);
            }
            
            // Convert chunk to binary data
            const byteCharacters = atob(chunkResult.chunk);
            const byteNumbers = new Array(byteCharacters.length);
            for (let j = 0; j < byteCharacters.length; j++) {
              byteNumbers[j] = byteCharacters.charCodeAt(j);
            }
            
            // Create chunk data and add to array
            const chunkUint8Array = new Uint8Array(byteNumbers);
            chunkBlobs.push(chunkUint8Array);
            
            // Track download progress
            downloadedBytes += byteCharacters.length;
            
          } catch (chunkError: any) {
            // Handle pause/cancel errors specially
            if (chunkError.message?.includes('paused')) {
              debugLog('Download paused - waiting for user to resume');
              // Wait for resume or cancel
              while (true) {
                // Check current download status
                const activeDownload = await new Promise<{activeDownload?: any}>((resolve) => {
                  chrome.storage.local.get('activeDownload', (result) => {
                    resolve(result as {activeDownload?: any});
                  });
                });
                
                // If download is gone or cancelled, abort
                if (!activeDownload.activeDownload || activeDownload.activeDownload.isCancelled) {
                  throw new Error('Download was cancelled');
                }
                
                // If download is resumed, break wait loop and retry
                if (!activeDownload.activeDownload.isPaused) {
                  i--; // Retry this chunk
                  break;
                }
                
                // Wait before checking again
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              continue; // Go to next iteration to retry
            } else if (chunkError.message?.includes('cancelled')) {
              debugLog('Download cancelled - aborting');
              throw new Error('Download was cancelled by user');
            } else {
              // For other errors, just rethrow
              throw chunkError;
            }
          }
          
          // No duplicate code here - we handled everything in the try block
          
          // Calculate progress percentage
          const progress = totalSizeBytesLocal > 0 ? 
            Math.round((downloadedBytes / totalSizeBytesLocal) * 100) : 
            Math.round(((i + 1) / totalChunks) * 100);
          
          // Calculate transfer rate
          const now = Date.now();
          const timeElapsed = (now - lastUpdateTime) / 1000; // seconds
          // Update more frequently to show real-time progress
          // Always update progress at least once per chunk - removed the time check
          // This ensures we see progress even if chunks download very quickly
          const bytesDownloadedSinceLastUpdate = downloadedBytes - lastDownloadedBytes;
          transferRate = Math.round((bytesDownloadedSinceLastUpdate / Math.max(timeElapsed, 0.1)) / 1024); // KB/s
          
          // Calculate time remaining
          const bytesRemaining = totalSizeBytesLocal - downloadedBytes;
          const timeRemaining = transferRate > 0 ? Math.ceil(bytesRemaining / (transferRate * 1024)) : 0;
          
          // Update tracking variables
          lastUpdateTime = now;
          lastDownloadedBytes = downloadedBytes;
            
          // Update detailed progress state
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          
          // Update individual chunk progress and all previous chunks
          const updatedChunks = [...chunks];
          
          // Mark current chunk with latest progress (might not be 100% yet)
          const thisChunkSize = bytesDownloadedSinceLastUpdate || Math.floor(totalSizeBytesLocal / totalChunks);
          updatedChunks[i] = {
            ...updatedChunks[i],
            // This chunk may still be downloading
            progress: Math.min(100, Math.round((bytesDownloadedSinceLastUpdate / updatedChunks[i].size) * 100)) || 100,
            downloaded: bytesDownloadedSinceLastUpdate || updatedChunks[i].size
          };
          
          // Make sure all previous chunks show as complete
          for (let j = 0; j < i; j++) {
            updatedChunks[j] = {
              ...updatedChunks[j],
              progress: 100,
              downloaded: updatedChunks[j].size
            };
          }
          
          // Create updated progress object
          const updatedProgress = {
            ...downloadProgress,
            percentComplete: progress,
            downloadedBytes,
            transferRate,
            timeRemaining,
            chunks: updatedChunks,
            lastUpdated: Date.now()
          };
            
          // Update UI state
          setDownloadProgress(updatedProgress);
          
          // Save to persistent storage for resilience
          saveDownloadProgress(updatedProgress);
        }
          
          // After all chunks are processed, finalize the download
          const downloadedMB = downloadedBytes ? (downloadedBytes / (1024 * 1024)).toFixed(2) : '0';
          // Calculate progress based on downloaded bytes
          const progress = (totalSizeBytesLocal && downloadedBytes) ? Math.round((downloadedBytes / totalSizeBytesLocal) * 100) : 0;
          setProgress(progress);
          // Calculate totalSizeMB directly
          const totalSizeMBFormatted = totalSizeBytesLocal > 0 ? (totalSizeBytesLocal / (1024 * 1024)).toFixed(2) : 'unknown';
          setProgressMessage(`Downloading ${filename} (${downloadedMB} MB / ${totalSizeMBFormatted} MB) - ${progress}%`);
          
          debugLog(`Retrieved all chunks for ${filename} (${downloadedMB}MB/${totalSizeMBFormatted}MB)`);
        
          // Combine all chunks into a single blob
          blob = new Blob(chunkBlobs as any, {type: type || 'application/octet-stream'});
          
          // Format total downloaded size for final message
          const finalSizeMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          setProgressMessage(`Download complete: ${filename} (${finalSizeMB} MB)`);
      }
        
        // Note: Service worker already saves completion data correctly for all files
        // No need to save again here as it would overwrite with stale state
        
        // Hide progress displays after a delay
        setTimeout(() => {
          setProgressVisible(false);
          // Don't hide the download dialog, as it can be useful to see completion stats
          // Instead, we'll just make it possible to dismiss it with the X button
        }, 3000);
        
        // Schedule cleanup after a longer period (e.g., 10 minutes)
        try {
          setTimeout(() => {
            // Check if this download is still the active one
            try {
              chrome.storage.local.get('activeDownload', (result) => {
                if (result.activeDownload && result.activeDownload.fileId === activeItem.id) {
                  // Clear the download from storage
                  chrome.storage.local.remove('activeDownload');
                }
              });
            } catch (storageError) {
              console.error('Error accessing storage:', storageError);
            }
          }, 10 * 60 * 1000); // 10 minutes
        } catch (timerError) {
          console.error('Error setting cleanup timer:', timerError);
        }
      
      // After all processing, create the download if we have a blob
      if (blob && blob instanceof Blob) {
        debugLog('File data processed, initiating download', { 
          filename, 
          fileType: type,
          blobSize: blob.size || 0 
        });
      
        // Create a URL for the blob
        const blobUrl = URL.createObjectURL(blob);
        
        // Create and trigger a download link
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename; // This sets the filename for the download
        a.style.display = 'none';
        document.body.appendChild(a);
        
        // Trigger the download
        a.click();
        
        // Clean up
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        
        debugLog('Download initiated successfully');
      }
      
      // Always clean up regardless of download success
      setActiveItem(null); // Clear the active item after operation
      setLoading(false); // Stop the loading indicator
      
    } catch (error: any) { // Catch for the main async function
      // Main error handler for setTimeout operation
      let errorMsg = '';
      
      // Show more user-friendly error messages for common issues
      if (error.message.includes('cannot be downloaded directly')) {
        // This is a special case for unsupported Google Workspace files
        errorMsg = error.message;
      } else if (error.message.includes('Rate limited')) {
        errorMsg = 'Google is rate limiting requests. Please wait a few minutes before trying again.';
      } else if (error.message.includes('429')) {
        errorMsg = 'Too many download requests. Please wait a few minutes before trying again.';
      } else if (error.message.includes('network')) {
        errorMsg = 'Network error. Please check your internet connection and try again.';
      } else if (error.message.includes('403')) {
        errorMsg = 'Access denied. You might not have permission to download this file.';
      } else {
        errorMsg = `Failed to initiate download: ${error.message}`;
      }
      
      debugLog('ERROR: Download failed', error);
      setError(errorMsg);
      setLoading(false); // Make sure to stop loading on error too
    
      // Create error state object
      const errorState = {
        ...downloadProgress,
        status: 'error' as 'downloading' | 'completed' | 'error',
        percentComplete: 0,
        errorMessage: errorMsg,
        errorTime: Date.now()
      };
      
      // Update download dialog to show error state
      setDownloadProgress(errorState);
      
      // Save error state to storage
      saveDownloadProgress(errorState);
      
      // Keep error visible but schedule cleanup after a longer period
      setTimeout(() => {
        chrome.storage.local.remove('activeDownload');
      }, 30 * 60 * 1000); // 30 minutes
    }
  }, 0); // End of setTimeout - 0ms delay to ensure UI update before download starts
  }; // End of handleDownloadItem

  // Handle cancelling copy operation
  const handleCancelCopy = async () => {
    // Get fileId from copyProgress if activeItem is not available (e.g., after reopening)
    const fileId = activeItem?.id || copyProgress.fileId;
    
    if (!fileId) {
      debugLog('Cannot cancel: no fileId available');
      return;
    }
    
    try {
      debugLog('Cancelling copy operation', { fileId });
      
      // Send cancel message and wait for confirmation
      const result = await sendMessage({
        type: 'CANCEL_COPY',
        payload: { fileId }
      });
      
      debugLog('Cancel result:', result);
      
      // Ensure storage is cleared
      await chrome.storage.local.remove('activeCopyOperation');
      
      // Hide progress dialog after a brief moment to ensure state is synced
      setTimeout(() => {
        setCopyProgress({
          visible: false,
          percentComplete: 0,
          bytesTransferred: 0,
          totalBytes: 0,
          fileName: '',
          destinationFolderName: '',
          fileId: undefined
        });
      }, 100);
      
      setSuccess('Copy operation cancelled');
    } catch (error: any) {
      debugLog('Error cancelling copy', error);
      
      // Force clear storage even on error
      await chrome.storage.local.remove('activeCopyOperation');
      
      // Still hide the dialog
      setCopyProgress({
        visible: false,
        percentComplete: 0,
        bytesTransferred: 0,
        totalBytes: 0,
        fileName: '',
        destinationFolderName: '',
        fileId: undefined
      });
      
      setError(`Failed to cancel: ${error.message}`);
    }
  };

  // Handle copying file to another account
  const handleCopyItem = async () => {
    if (!activeItem || !copyDestinationAccount) {
      setError('Please select a destination account');
      return;
    }

    try {
      // Get destination folder name for display
      let destinationFolderName = 'My Drive';
      if (copyDestinationFolder !== 'root') {
        const folder = destinationFolders.find(f => f.id === copyDestinationFolder);
        destinationFolderName = folder?.name || 'Selected Folder';
      }
      
      // Show progress dialog immediately
      setCopyProgress({
        visible: true,
        percentComplete: 0,
        bytesTransferred: 0,
        totalBytes: activeItem.size || 0,
        fileName: activeItem.name,
        destinationFolderName,
        fileId: activeItem.id,
        lastUpdateTime: Date.now()
      });
      
      // Close the copy dialog
      setCopyDialogOpen(false);
      setLoading(true);
      
      debugLog('Copying file', {
        sourceAccount: currentAccountId,
        destinationAccount: copyDestinationAccount,
        fileId: activeItem.id,
        destinationFolder: copyDestinationFolder
      });

      const response = await sendMessage<{ success: boolean; id?: string; webViewLink?: string; error?: string }>({
        type: 'COPY_FILE',
        payload: {
          sourceAccountId: currentAccountId,
          destinationAccountId: copyDestinationAccount,
          fileId: activeItem.id,
          destinationFolderId: copyDestinationFolder,
          fileName: activeItem.name,
          destinationFolderName: destinationFolderName,
        },
      });

      if (response.success) {
        // Update progress to 100% on completion
        setCopyProgress(prev => ({
          ...prev,
          percentComplete: 100,
          bytesTransferred: prev.totalBytes,
          destinationFolderName: prev.destinationFolderName,
          lastUpdateTime: Date.now()
        }));
        
        setSuccess(`Successfully copied "${activeItem.name}" to the destination account!`);
        
        // Hide progress dialog after a brief delay
        setTimeout(() => {
          setCopyProgress({
            visible: false,
            percentComplete: 0,
            bytesTransferred: 0,
            totalBytes: 0,
            fileName: '',
            destinationFolderName: '',
            fileId: undefined,
            lastUpdateTime: undefined
          });
        }, 2000);
        
        // Reset copy form
        setCopyDestinationAccount('');
        setCopyDestinationFolder('root');
        setActiveItem(null);
      } else {
        setCopyProgress({
          visible: false,
          percentComplete: 0,
          bytesTransferred: 0,
          totalBytes: 0,
          fileName: '',
          destinationFolderName: '',
          fileId: undefined,
          lastUpdateTime: undefined
        });
        throw new Error(response.error || 'Unknown error occurred');
      }
    } catch (err: any) {
      debugLog('Error copying file', err);
      setError(`Failed to copy: ${err.message}`);
      setCopyProgress({
        visible: false,
        percentComplete: 0,
        bytesTransferred: 0,
        totalBytes: 0,
        fileName: '',
        destinationFolderName: '',
        fileId: undefined,
        lastUpdateTime: undefined
      });
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatTimeRemaining = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '—';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  // Get thumbnail URL for file
  const getThumbnailUrl = (item: DriveItem): string => {
    if (item.isFolder) {
      // Return folder icon
      return '';
    }
    // For files, use Google Drive thumbnail API if available
    if ((item as any).thumbnailLink) {
      return (item as any).thumbnailLink;
    }
    return '';
  };

  // Multi-selection handlers
  const toggleMultiSelectMode = () => {
    const newMode = !multiSelectMode;
    setMultiSelectMode(newMode);
    if (!newMode) {
      // Clear selections when turning off multi-select mode
      setSelectedItems(new Set());
    }
  };

  const handleItemSelection = (itemId: string, index: number, event: React.MouseEvent) => {
    if (!multiSelectMode) return;
    
    event.stopPropagation();
    
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
    setLastSelectedIndex(index);
  };

  const handleMouseDown = (index: number, event: React.MouseEvent) => {
    if (!multiSelectMode) return;
    
    // Only start drag selection on left click
    if (event.button === 0) {
      event.preventDefault(); // Prevent default drag behavior (text selection, drag-and-drop)
      setIsDragSelecting(true);
      setDragStartIndex(index);
      setLastSelectedIndex(index);
    }
  };

  const handleMouseEnter = (itemId: string, index: number) => {
    if (!multiSelectMode || !isDragSelecting || dragStartIndex === null) return;
    
    // Select all items between dragStartIndex and current index
    const start = Math.min(dragStartIndex, index);
    const end = Math.max(dragStartIndex, index);
    
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      for (let i = start; i <= end; i++) {
        if (items[i]) {
          newSet.add(items[i].id);
        }
      }
      return newSet;
    });
  };

  const handleMouseUp = () => {
    setIsDragSelecting(false);
    setDragStartIndex(null);
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    
    try {
      setLoading(true);
      const itemsArray = Array.from(selectedItems);
      
      for (const itemId of itemsArray) {
        await sendMessage({
          type: 'DELETE_ITEM',
          payload: { itemId }
        });
      }
      
      setSuccess(`Moved ${selectedItems.size} item(s) to trash`);
      setSelectedItems(new Set());
      
      // Refresh the current folder
      if (viewingTrash) {
        loadTrash();
      } else {
        loadFolderContents(currentFolderId);
      }
      
      // Update storage display
      await refreshStorageQuota();
      if (onStorageUpdate) {
        onStorageUpdate();
      }
    } catch (error: any) {
      setError(`Failed to delete items: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedItems.size === 0) return;
    
    try {
      const itemsArray = Array.from(selectedItems);
      const filesToDownload = items.filter(item => 
        itemsArray.includes(item.id) && !item.isFolder
      );
      
      if (filesToDownload.length === 0) {
        setError('No files selected for download (folders cannot be downloaded)');
        return;
      }
      
      // Show zipping progress dialog
      setZipProgress({
        visible: true,
        filesCount: filesToDownload.length,
        currentFile: 0,
        currentFileName: 'Preparing...'
      });
      
      // Create a new JSZip instance for online zipping
      const zip = new JSZip();
      
      // Step 1: Fetch each file and add to zip (NOT downloading to disk yet)
      for (let i = 0; i < filesToDownload.length; i++) {
        const file = filesToDownload[i];
        
        // Update progress - showing current file being processed
        setZipProgress(prev => ({
          ...prev,
          currentFile: i + 1,
          currentFileName: file.name
        }));
        
        try {
          // Fetch file content from service worker (in memory, NO browser download)
          const result = await sendMessage<{ base64Data: string, filename: string, type: string }>({
            type: 'FETCH_FILE_CONTENT',
            payload: { fileId: file.id }
          });
          
          if (result && result.base64Data) {
            debugLog(`Adding file to zip: ${result.filename}`);
            // Convert base64 to binary and add to zip
            const binaryString = atob(result.base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let j = 0; j < binaryString.length; j++) {
              bytes[j] = binaryString.charCodeAt(j);
            }
            zip.file(result.filename, bytes);
          } else {
            debugLog(`Skipping file (no data returned): ${file.name}`);
          }
        } catch (fileError: any) {
          debugLog(`Error fetching file ${file.name}:`, fileError);
          // Continue with other files even if one fails
        }
      }
      
      // Step 2: Generate the zip file (online compression)
      debugLog('Compressing files into zip archive...');
      setZipProgress(prev => ({
        ...prev,
        currentFileName: 'Compressing...'
      }));
      
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });
      
      // Step 3: Download ONLY the final zip file (single download)
      debugLog('Downloading zip file...');
      const zipUrl = URL.createObjectURL(zipBlob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const zipFilename = `google-drive-files-${timestamp}.zip`;
      
      const downloadLink = document.createElement('a');
      downloadLink.href = zipUrl;
      downloadLink.download = zipFilename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Clean up the object URL
      setTimeout(() => URL.revokeObjectURL(zipUrl), 100);
      
      // Hide progress dialog
      setZipProgress({
        visible: false,
        filesCount: 0,
        currentFile: 0,
        currentFileName: ''
      });
      
      setSuccess(`Downloaded ${filesToDownload.length} file(s) as ${zipFilename}`);
      setSelectedItems(new Set()); // Clear selection after successful download
    } catch (error: any) {
      setError(`Failed to create zip file: ${error.message}`);
      setZipProgress({
        visible: false,
        filesCount: 0,
        currentFile: 0,
        currentFileName: ''
      });
    }
  };

  const handleBulkMove = async () => {
    if (selectedItems.size === 0) return;
    
    // Open move dialog for bulk move
    setMoveDialogOpen(true);
    loadAvailableFolders(); // Load folders for the destination picker
  };

  const executeBulkMove = async () => {
    if (selectedItems.size === 0) return;
    if (!moveTargetFolder) {
      setError('No destination folder selected');
      return;
    }
    
    try {
      setLoading(true);
      const itemsArray = Array.from(selectedItems);
      
      for (const itemId of itemsArray) {
        await sendMessage({
          type: 'MOVE_ITEM',
          payload: { 
            itemId, 
            newParentId: moveTargetFolder 
          }
        });
      }
      
      // Refresh the current folder
      loadFolderContents(currentFolderId);
      
      // Show success message
      const targetFolder = availableFolders.find(f => f.id === moveTargetFolder);
      setSuccess(`Moved ${selectedItems.size} item(s) to "${targetFolder?.name || 'destination folder'}"`);
      setMoveDialogOpen(false);
      setSelectedItems(new Set());
      
      // Clear form data
      setMoveTargetFolder('');
    } catch (error: any) {
      setError(`Failed to move items: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Clear selections when changing folders or views
  useEffect(() => {
    setSelectedItems(new Set());
  }, [currentFolderId, viewingTrash, viewingSharedWithMe, searchMode]);

  // Add global mouse up listener to handle drag selection end
  useEffect(() => {
    if (multiSelectMode) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [multiSelectMode, isDragSelecting]);

  // Add keyboard shortcut to toggle multi-select mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Toggle multi-select mode with Ctrl+Shift+M (only in normal folder view)
      if (event.ctrlKey && event.shiftKey && (event.key === 'M' || event.key === 'm') && !viewingTrash && !viewingSharedWithMe) {
        event.preventDefault();
        toggleMultiSelectMode();
      }
      
      // Turn off multi-select mode with Escape key
      if (event.key === 'Escape' && multiSelectMode) {
        event.preventDefault();
        setMultiSelectMode(false);
        setSelectedItems(new Set());
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [multiSelectMode, viewingTrash, viewingSharedWithMe]);

  // Render component
  return (
    <Box>
      {/* Search Component - only show in normal folder view */}
      {!viewingTrash && !viewingSharedWithMe && (
        <SearchComponent onSearch={handleSearch} onClear={handleClearSearch} />
      )}
      
      {/* Header with buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, mt: 2, px: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* View Mode Toggle - hide when viewing shared with me */}
          {!viewingSharedWithMe && (
            <Box sx={{ 
              display: 'flex', 
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden'
            }}>
              <IconButton
                size="small"
                onClick={() => handleViewModeChange('list')}
                sx={{
                  borderRadius: 0,
                  bgcolor: viewMode === 'list' ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: viewMode === 'list' ? 'action.selected' : 'action.hover' }
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
                </svg>
              </IconButton>
              <IconButton
                size="small"
                onClick={() => handleViewModeChange('grid')}
                sx={{
                  borderRadius: 0,
                  bgcolor: viewMode === 'grid' ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: viewMode === 'grid' ? 'action.selected' : 'action.hover' }
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>
                </svg>
              </IconButton>
            </Box>
          )}
          
          {viewingTrash || viewingSharedWithMe ? (
            <Button
              variant="contained"
              startIcon={<MyDriveIcon fontSize="20px" />}
              onClick={() => {
                setViewingTrash(false);
                setViewingSharedWithMe(false);
              }}
              size="small"
              sx={{
                bgcolor: '#1976d2',
                color: 'white',
                textTransform: 'none',
                fontWeight: 500,
                px: 2,
                '&:hover': {
                  bgcolor: '#1565c0'
                }
              }}
            >
              My Drive
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                startIcon={<SharedWithMeIcon fontSize="20px" />}
                onClick={() => {
                  setViewingSharedWithMe(true);
                  setViewingTrash(false);
                }}
                size="small"
                sx={{
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2,
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.05)'
                  }
                }}
              >
                Shared
              </Button>
              <Button
                variant="outlined"
                startIcon={<TrashIcon />}
                onClick={() => {
                  setViewingTrash(true);
                  setViewingSharedWithMe(false);
                }}
                size="small"
                sx={{
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2,
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.05)'
                  }
                }}
              >
                Trash
              </Button>
            </>
          )}
          
          {/* Empty Trash Button - only show when viewing trash */}
          {viewingTrash && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DeleteForeverIcon />}
              onClick={() => setEmptyTrashConfirmOpen(true)}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
                px: 2,
                '&:hover': {
                  bgcolor: 'rgba(244, 67, 54, 0.08)'
                }
              }}
            >
              Empty Trash
            </Button>
          )}
          
          {/* Download Manager Toggle Button - only show when NOT viewing trash or shared */}
          {!viewingTrash && !viewingSharedWithMe && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<GetAppIcon />}
              onClick={toggleDownloadDialog}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
                px: 2,
                '&:hover': {
                  bgcolor: 'rgba(33, 150, 243, 0.08)'
                }
              }}
            >
              Downloads
            </Button>
          )}
          
          {/* Multi-Select Mode Toggle Button - only show when NOT viewing trash or shared */}
          {!viewingTrash && !viewingSharedWithMe && (
            <Tooltip title="Toggle multi-select mode (Ctrl+Shift+M | Escape to exit)" arrow>
              <Button
                variant={multiSelectMode ? "contained" : "outlined"}
                size="small"
                startIcon={multiSelectMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
                onClick={toggleMultiSelectMode}
                sx={{
                  bgcolor: multiSelectMode ? '#1976d2' : 'transparent',
                  color: multiSelectMode ? 'white' : undefined,
                  textTransform: 'none',
                  fontWeight: 500,
                  px: 2,
                  '&:hover': {
                    bgcolor: multiSelectMode ? '#1565c0' : 'rgba(255, 255, 255, 0.05)'
                  }
                }}
              >
                {multiSelectMode ? `Selected (${selectedItems.size})` : 'Select'}
              </Button>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Breadcrumbs / Search Results Info */}
      {!viewingTrash && !viewingSharedWithMe && !searchMode && (
        <Paper sx={{ p: 1.5, mb: 2, mx: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Back to Shared with me icon button */}
          {cameFromSharedWithMe && (
            <Tooltip title="Back to Shared with me">
              <IconButton
                onClick={handleBackToSharedWithMe}
                size="small"
                sx={{ 
                  color: 'primary.main',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
              >
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          
          <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />}>
            {breadcrumbs.map((crumb, index) => (
              <Link
                key={crumb.id}
                component="button"
                variant="body2"
                onClick={() => handleBreadcrumbClick(index)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  textDecoration: 'none',
                  color: index === breadcrumbs.length - 1 ? 'text.primary' : 'primary.main',
                  fontWeight: index === breadcrumbs.length - 1 ? 600 : 400
                }}
              >
                {index === 0 && <MyDriveIcon fontSize="20px" />}
                {crumb.name}
              </Link>
            ))}
          </Breadcrumbs>
        </Paper>
      )}
      
      {searchMode && (
        <Paper sx={{ p: 1.5, mb: 2, mx: 2, bgcolor: 'info.light' }}>
          <Typography variant="body2" color="text.primary">
            <strong>Search Results:</strong> {items.length} item{items.length !== 1 ? 's' : ''} found
            {lastSearchParams?.query && ` for "${lastSearchParams.query}"`}
          </Typography>
        </Paper>
      )}

      {/* Error alerts */}
      {error && (
        <Alert 
          severity="error" 
          onClose={() => setError(null)} 
          sx={{ mb: 2 }}
          action={
            <Button 
              color="inherit" 
              size="small" 
              onClick={() => {
                if (viewingTrash) {
                  loadTrash();
                } else {
                  loadFolderContents(currentFolderId);
                }
              }}
            >
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* Success alerts */}
      {success && (
        <Alert 
          severity="success" 
          onClose={() => setSuccess(null)} 
          sx={{ mb: 2 }}
        >
          {success}
        </Alert>
      )}

      {/* Simple download progress indicator (legacy) */}
      {progressVisible && !downloadProgress.visible && (
        <Box sx={{ 
          position: 'sticky', 
          bottom: 16, 
          left: 0,
          right: 0,
          width: '80%',
          margin: '0 auto',
          backgroundColor: 'background.paper',
          boxShadow: 3,
          borderRadius: 1,
          p: 2,
          zIndex: 10
        }}>
          <Typography variant="body2" gutterBottom>
            {progressMessage}
          </Typography>
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            sx={{ height: 8, borderRadius: 4 }} 
          />
        </Box>
      )}
      
      {/* Detailed download progress dialog - similar to image */}
      <Dialog
        open={downloadProgress.visible}
        maxWidth="md"
        PaperProps={{
          sx: {
            borderRadius: 2,
            boxShadow: 24,
          },
        }}
      >
        <DialogTitle sx={{ 
          p: 2, 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>
            {downloadProgress.status === 'downloading' 
              ? downloadProgress.isPaused ? 'Download Paused' : 'Downloading...' 
              : downloadProgress.status === 'completed' ? 'Download Complete' : 'Download Error'}
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 1 }}>
            {/* Close button */}
            <IconButton 
              size="small"
              onClick={() => setDownloadProgress(prev => ({ ...prev, visible: false }))}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
            
            {downloadProgress.status === 'downloading' && (
              <Button 
                variant="outlined" 
                size="small"
                sx={{ 
                  minWidth: 0, 
                  px: 2, 
                  py: 0.5, 
                  fontSize: '0.8rem',
                  textTransform: 'none'
                }}
                onClick={async () => {
                  try {
                    // Toggle pause state
                    const isPaused = !(downloadProgress as any).isPaused;
                    
                    // Update local state immediately for responsive UI (don't save to storage yet)
                    setDownloadProgress(prev => ({
                      ...prev,
                      isPaused: isPaused,
                      visible: true // Keep dialog visible
                    }));
                    
                    // Send pause request to service worker (it will update storage)
                    const result = await sendMessage<{ success: boolean }>({ 
                      type: 'PAUSE_DOWNLOAD', 
                      payload: { 
                        downloadId: downloadProgress.downloadId,
                        isPaused 
                      } 
                    });
                    
                    debugLog(`Download ${isPaused ? 'paused' : 'resumed'}: ${result.success}`);
                  } catch (error) {
                    debugLog('Error toggling download pause:', error);
                  }
                }}
              >
                {(downloadProgress as any).isPaused ? 'Resume' : 'Pause'}
              </Button>
            )}
            <Button 
              variant="outlined" 
              size="small"
              color="error"
              sx={{ 
                minWidth: 0, 
                px: 2, 
                py: 0.5, 
                fontSize: '0.8rem',
                textTransform: 'none'
              }}
              onClick={async () => {
                try {
                  // Cancel the download properly via service worker
                  if (downloadProgress.downloadId) {
                    // Update UI immediately to show cancel state (keep visible)
                    setDownloadProgress(prev => ({
                      ...prev,
                      status: 'error',
                      isCancelled: true,
                      visible: true
                    }));
                    
                    // Send cancel request to service worker
                    const result = await sendMessage<{ success: boolean }>({ 
                      type: 'CANCEL_DOWNLOAD', 
                      payload: { downloadId: downloadProgress.downloadId } 
                    });
                    
                    debugLog(`Download cancelled: ${result.success}`);
                    
                    // Service worker will handle storage cleanup after delay
                  } else {
                    // Fallback if no downloadId is available
                    chrome.storage.local.remove('activeDownload');
                    setDownloadProgress(prev => ({ ...prev, visible: false }));
                  }
                } catch (error) {
                  debugLog('Error cancelling download:', error);
                  // Hide the dialog anyway
                  setDownloadProgress(prev => ({ ...prev, visible: false }));
                }
              }}
            >
              Cancel
            </Button>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ p: 3, pt: 2.5 }}>
          {/* Filename */}
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 2, wordBreak: 'break-all' }}>
            {downloadProgress.filename}
          </Typography>
          
          {/* Overall progress bar - moved to top */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {downloadProgress.status === 'completed' 
                  ? 'Complete'
                  : downloadProgress.status === 'downloading' 
                    ? downloadProgress.isPaused 
                      ? 'Paused' 
                      : 'Downloading...'
                    : downloadProgress.isCancelled 
                      ? 'Cancelled' 
                      : downloadProgress.status === 'error'
                        ? 'Error'
                        : 'Complete'}
              </Typography>
              <Typography variant="body2" fontWeight="600">
                {downloadProgress.percentComplete}%
              </Typography>
            </Box>
            <Box sx={{ 
              width: '100%', 
              height: 8, 
              bgcolor: 'action.hover',
              borderRadius: 1,
              overflow: 'hidden',
              position: 'relative'
            }}>
              <Box 
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${downloadProgress.percentComplete}%`,
                  bgcolor: downloadProgress.isPaused 
                    ? 'warning.main' 
                    : downloadProgress.status === 'error' 
                      ? 'error.main' 
                      : 'success.main',
                  transition: 'width 0.3s ease-in-out, background-color 0.3s',
                  borderRadius: 1,
                }}
              />
            </Box>
            {downloadProgress.status === 'downloading' && !downloadProgress.isPaused && downloadProgress.transferRate > 0 && (
              <Typography 
                variant="body2" 
                color="primary" 
                fontWeight="600"
                sx={{ mt: 1, textAlign: 'center' }}
              >
                {downloadProgress.transferRate > 1024 
                  ? `${(downloadProgress.transferRate/1024).toFixed(2)} MB/s` 
                  : `${downloadProgress.transferRate.toFixed(0)} KB/s`}
              </Typography>
            )}
          </Box>
          
          {/* Key metrics */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" display="block">
                File size
              </Typography>
              <Typography variant="body2" fontWeight="500">
                {downloadProgress.fileSize || `${(downloadProgress.totalBytes / (1024 * 1024)).toFixed(2)} MB`}
              </Typography>
            </Grid>
            
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" display="block">
                Downloaded
              </Typography>
              <Typography variant="body2" fontWeight="500">
                {(downloadProgress.downloadedBytes / (1024 * 1024)).toFixed(2)} MB
              </Typography>
            </Grid>
            
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" display="block">
                Transfer rate
              </Typography>
              <Typography variant="body2" fontWeight="500">
                {downloadProgress.status === 'completed' && downloadProgress.transferRate === 0
                  ? '—'
                  : downloadProgress.transferRate > 1024
                    ? `${(downloadProgress.transferRate/1024).toFixed(2)} MB/s`
                    : `${downloadProgress.transferRate.toFixed(0)} KB/s`}
              </Typography>
            </Grid>
            
            <Grid item xs={6}>
              <Typography variant="caption" color="text.secondary" display="block">
                Time left
              </Typography>
              <Typography variant="body2" fontWeight="500">
                {downloadProgress.status === 'completed' ? '—' : formatTimeRemaining(downloadProgress.timeRemaining)}
              </Typography>
            </Grid>
          </Grid>
          
          
          <Button 
            size="small"
            variant="text"
            onClick={() => setShowDownloadDetails(!showDownloadDetails)} 
            sx={{ fontSize: '0.8rem', mt: 1 }}
            endIcon={<ExpandMoreIcon fontSize="small" sx={{ transform: showDownloadDetails ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />}
          >
            {showDownloadDetails ? 'Hide' : 'Show'} connection details
          </Button>
          
          {/* Connection progress bars - conditionally shown */}
          {showDownloadDetails && (
          <>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
              Start positions and download progress by connections
            </Typography>
            
            <Box sx={{ 
              height: 16, 
              width: '100%', 
              bgcolor: 'action.hover', 
              position: 'relative',
              overflow: 'hidden',
              display: 'flex'
            }}>
              {downloadProgress.chunks.map((chunk, index) => {
                const startPercent = (index / downloadProgress.chunks.length) * 100;
                const widthPercent = (1 / downloadProgress.chunks.length) * 100;
                
                return (
                  <Box 
                    key={chunk.id}
                    sx={{
                      position: 'relative',
                      width: `${widthPercent}%`,
                      height: '100%',
                      borderRight: index < downloadProgress.chunks.length - 1 ? 1 : 'none',
                      borderColor: 'divider'
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: `${chunk.progress}%`,
                        bgcolor: index % 2 === 0 ? 'primary.main' : 'primary.light',
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          </Box>
          
          {/* Connection details */}
          <Box sx={{ 
            maxHeight: 120, 
            overflowY: 'auto', 
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: '#bbb',
              borderRadius: '4px',
            }
          }}>
            <Table size="small" sx={{ '& td, & th': { fontSize: '0.75rem', py: 0.5 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 30 }}>N.</TableCell>
                  <TableCell>Downloaded</TableCell>
                  <TableCell>Info</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {downloadProgress.chunks.map((chunk, index) => (
                  <TableRow key={chunk.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      {(chunk.downloaded / 1024).toFixed(0)} KB
                    </TableCell>
                    <TableCell>
                      {downloadProgress.status === 'downloading' ? 'Downloading...' : 'Complete'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          </>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Trash emptying progress dialog - similar to Windows file operations */}
      <Dialog
        open={emptyTrashProgress.visible}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 1,
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ 
          bgcolor: 'background.paper', 
          p: 1.5, 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: 1,
          borderColor: 'divider'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
              {emptyTrashProgress.percentComplete}% complete
            </Typography>
          </Box>
          
          <Box>
            <IconButton 
              size="small" 
              disabled={emptyTrashProgress.status === 'completed'}
              onClick={() => setEmptyTrashProgress(prev => ({ ...prev, visible: false }))}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ p: 2, pt: 2 }}>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {emptyTrashProgress.status === 'deleting' 
              ? `Deleting ${emptyTrashProgress.totalItems.toLocaleString()} items` 
              : 'Delete completed'}
          </Typography>
          
          <Box sx={{ 
            width: '100%',
            height: 24,
            bgcolor: 'action.hover',
            borderRadius: 0.5,
            mb: 2,
            overflow: 'hidden',
            border: 1,
            borderColor: 'divider',
          }}>
            <Box 
              sx={{
                height: '100%',
                width: `${emptyTrashProgress.percentComplete}%`,
                bgcolor: 'success.main',
                transition: 'width 0.3s ease-in-out',
                display: 'flex',
                alignItems: 'center',
                pl: 1
              }}
            >
              <Box 
                sx={{
                  height: '60%',
                  width: '60%',
                  backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'progressAnimation 2s linear infinite',
                  '@keyframes progressAnimation': {
                    '0%': {
                      backgroundPosition: '100% 0'
                    },
                    '100%': {
                      backgroundPosition: '-100% 0'
                    }
                  }
                }}
              />
            </Box>
          </Box>
          
          <Grid container spacing={1}>
            <Grid item xs={4}>
              <Typography variant="body2" color="text.secondary">Name:</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2" noWrap title={emptyTrashProgress.currentFile}>
                {emptyTrashProgress.currentFile || 'Processing...'}
              </Typography>
            </Grid>
            
            <Grid item xs={4}>
              <Typography variant="body2" color="text.secondary">Time remaining:</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">
                {emptyTrashProgress.deleteSpeed > 0 && emptyTrashProgress.itemsRemaining > 0
                  ? `${Math.ceil(emptyTrashProgress.itemsRemaining / emptyTrashProgress.deleteSpeed)} seconds`
                  : 'Calculating...'}
              </Typography>
            </Grid>
            
            <Grid item xs={4}>
              <Typography variant="body2" color="text.secondary">Items remaining:</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">
                {emptyTrashProgress.itemsRemaining.toLocaleString()} ({formatFileSize(emptyTrashProgress.remainingSizeBytes)})
              </Typography>
            </Grid>
            
            <Grid item xs={4}>
              <Typography variant="body2" color="text.secondary">Speed:</Typography>
            </Grid>
            <Grid item xs={8}>
              <Typography variant="body2">
                {emptyTrashProgress.deleteSpeed} items/s
              </Typography>
            </Grid>
          </Grid>
        </DialogContent>
      </Dialog>
      
      {/* Zipping progress snackbar */}
      <Snackbar
        open={zipProgress.visible}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          '& .MuiSnackbarContent-root': {
            minWidth: '300px',
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 3,
            borderRadius: 1
          }
        }}
      >
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: 1,
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 1,
          boxShadow: 3,
          minWidth: '300px'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" fontWeight={600}>
              {zipProgress.currentFileName === 'Preparing...' 
                ? 'Preparing files...' 
                : zipProgress.currentFileName === 'Compressing...'
                ? 'Compressing files...'
                : `Zipping ${zipProgress.filesCount} ${zipProgress.filesCount === 1 ? 'file' : 'files'}`
              }
            </Typography>
          </Box>
          {zipProgress.currentFile > 0 && zipProgress.currentFileName !== 'Compressing...' && (
            <Box>
              <Typography variant="caption" color="text.secondary" noWrap>
                {zipProgress.currentFile}/{zipProgress.filesCount}: {zipProgress.currentFileName}
              </Typography>
            </Box>
          )}
        </Box>
      </Snackbar>

      {/* File list */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : viewingSharedWithMe ? (
        <SharedWithMeView 
          onError={setError}
          onSuccess={setSuccess}
          onNavigate={handleSharedItemClick}
        />
      ) : viewingTrash ? (
        viewMode === 'grid' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2, mb: 2 }}>
            {items.map((item, index) => (
              <Card
                key={item.id}
                onClick={(e) => {
                  if (multiSelectMode) {
                    handleItemSelection(item.id, index, e);
                  } else {
                    handleItemClick(item);
                  }
                }}
                onMouseDown={(e) => handleMouseDown(index, e)}
                onMouseEnter={() => handleMouseEnter(item.id, index)}
                onContextMenu={(e) => {
                  // On right-click, if multi-select mode and items are selected
                  if (multiSelectMode && selectedItems.size > 0) {
                    e.preventDefault();
                    if (!selectedItems.has(item.id)) {
                      setSelectedItems(prev => new Set(prev).add(item.id));
                    }
                    handleMenuOpen(e, item);
                  }
                }}
                sx={{
                  cursor: 'pointer',
                  border: 2,
                  borderColor: selectedItems.has(item.id) ? 'primary.main' : 'divider',
                  bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'transparent',
                  '&:hover': { boxShadow: 2 }
                }}
              >
                <CardActionArea>
                  <Box sx={{ position: 'relative', height: 140, bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.isFolder ? (
                      item.shared === true ?
                        <SharedFolderIcon sx={{ fontSize: 64, color: 'primary.main' }} /> :
                        <FolderIcon sx={{ fontSize: 64, color: 'primary.main' }} />
                    ) : getThumbnailUrl(item) ? (
                      <Box
                        component="img"
                        src={getThumbnailUrl(item)}
                        alt={item.name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <InsertDriveFileIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
                    )}
                    {multiSelectMode && (
                      <Checkbox
                        checked={selectedItems.has(item.id)}
                        sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: 1 }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (multiSelectMode && selectedItems.size > 0 && !selectedItems.has(item.id)) {
                          setSelectedItems(prev => new Set(prev).add(item.id));
                        }
                        handleMenuOpen(e, item); 
                      }}
                      sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper' }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <CardContent sx={{ p: 1 }}>
                    <Typography variant="body2" noWrap title={item.name}>
                      {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {formatFileSize(item.size)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        ) : (
          <List>
          {items.map((item, index) => (
            <ListItem
              key={item.id}
              button
              onClick={(e) => {
                if (multiSelectMode) {
                  handleItemSelection(item.id, index, e);
                } else {
                  handleItemClick(item);
                }
              }}
              onMouseDown={(e) => handleMouseDown(index, e)}
              onMouseEnter={() => handleMouseEnter(item.id, index)}
              onContextMenu={(e) => {
                // On right-click, if multi-select mode and items are selected
                if (multiSelectMode && selectedItems.size > 0) {
                  e.preventDefault();
                  // If clicked item is not in selection, add it
                  if (!selectedItems.has(item.id)) {
                    setSelectedItems(prev => new Set(prev).add(item.id));
                  }
                  handleMenuOpen(e, item);
                }
              }}
              sx={{
                border: 1,
                borderColor: selectedItems.has(item.id) ? 'primary.main' : 'divider',
                borderRadius: 1,
                mb: 1,
                bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'action.hover' }
              }}
            >
              {multiSelectMode && (
                <Checkbox
                  edge="start"
                  checked={selectedItems.has(item.id)}
                  tabIndex={-1}
                  disableRipple
                  sx={{ mr: 1 }}
                />
              )}
              <ListItemIcon>
                {item.isFolder ? 
                  (item.shared === true ? 
                    <SharedFolderIcon color="primary" /> : 
                    <FolderIcon color="primary" />
                  ) : 
                  <InsertDriveFileIcon />
                }
              </ListItemIcon>
              <ListItemText
                primary={<Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <span>{item.name}</span>
                </Box>}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 2, fontSize: '0.875rem' }}>
                    <span>{formatFileSize(item.size)}</span>
                    <span>Modified: {formatDate(item.modifiedTime)}</span>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton edge="end" onClick={(e) => {
                  e.stopPropagation();
                  if (multiSelectMode && selectedItems.size > 0 && !selectedItems.has(item.id)) {
                    // If in multi-select with selections, add this item to selection when menu is opened
                    setSelectedItems(prev => new Set(prev).add(item.id));
                  }
                  handleMenuOpen(e, item);
                }}>
                  <MoreVertIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
        )
      ) : (
        viewMode === 'grid' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2, mb: 2 }}>
            {items.map((item, index) => (
              <Card
                key={item.id}
                onClick={(e) => {
                  if (multiSelectMode) {
                    handleItemSelection(item.id, index, e);
                  } else {
                    handleItemClick(item);
                  }
                }}
                onMouseDown={(e) => handleMouseDown(index, e)}
                onMouseEnter={() => handleMouseEnter(item.id, index)}
                onContextMenu={(e) => {
                  // On right-click, if multi-select mode and items are selected
                  if (multiSelectMode && selectedItems.size > 0) {
                    e.preventDefault();
                    if (!selectedItems.has(item.id)) {
                      setSelectedItems(prev => new Set(prev).add(item.id));
                    }
                    handleMenuOpen(e, item);
                  }
                }}
                sx={{
                  cursor: 'pointer',
                  border: 2,
                  borderColor: selectedItems.has(item.id) ? 'primary.main' : 'divider',
                  bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'transparent',
                  '&:hover': { boxShadow: 2 }
                }}
              >
                <CardActionArea>
                  <Box sx={{ position: 'relative', height: 140, bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.isFolder ? (
                      item.shared === true ?
                        <SharedFolderIcon sx={{ fontSize: 64, color: 'primary.main' }} /> :
                        <FolderIcon sx={{ fontSize: 64, color: 'primary.main' }} />
                    ) : getThumbnailUrl(item) ? (
                      <Box
                        component="img"
                        src={getThumbnailUrl(item)}
                        alt={item.name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <InsertDriveFileIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
                    )}
                    {multiSelectMode && (
                      <Checkbox
                        checked={selectedItems.has(item.id)}
                        sx={{ position: 'absolute', top: 4, left: 4, bgcolor: 'background.paper', borderRadius: 1 }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <IconButton
                      size="small"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (multiSelectMode && selectedItems.size > 0 && !selectedItems.has(item.id)) {
                          setSelectedItems(prev => new Set(prev).add(item.id));
                        }
                        handleMenuOpen(e, item); 
                      }}
                      sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper' }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <CardContent sx={{ p: 1 }}>
                    <Typography variant="body2" noWrap title={item.name}>
                      {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {formatFileSize(item.size)}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        ) : (
          <List>
            {items.map((item, index) => (
            <ListItem
              key={item.id}
              button
              onClick={(e) => {
                if (multiSelectMode) {
                  handleItemSelection(item.id, index, e);
                } else {
                  handleItemClick(item);
                }
              }}
              onMouseDown={(e) => handleMouseDown(index, e)}
              onMouseEnter={() => handleMouseEnter(item.id, index)}
              onContextMenu={(e) => {
                // On right-click, if multi-select mode and items are selected
                if (multiSelectMode && selectedItems.size > 0) {
                  e.preventDefault();
                  // If clicked item is not in selection, add it
                  if (!selectedItems.has(item.id)) {
                    setSelectedItems(prev => new Set(prev).add(item.id));
                  }
                  handleMenuOpen(e, item);
                }
              }}
              sx={{
                border: 1,
                borderColor: selectedItems.has(item.id) ? 'primary.main' : 'divider',
                borderRadius: 1,
                mb: 1,
                bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: selectedItems.has(item.id) ? 'action.selected' : 'action.hover' }
              }}
            >
              {multiSelectMode && (
                <Checkbox
                  edge="start"
                  checked={selectedItems.has(item.id)}
                  tabIndex={-1}
                  disableRipple
                  sx={{ mr: 1 }}
                />
              )}
              <ListItemIcon>
                {item.isFolder ? 
                  (item.shared === true ? 
                    <SharedFolderIcon color="primary" /> : 
                    <FolderIcon color="primary" />
                  ) : 
                  <InsertDriveFileIcon />
                }
              </ListItemIcon>
              <ListItemText
                primary={<Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <span>{item.name}</span>
                </Box>}
                secondary={
                  <Box component="span" sx={{ display: 'flex', gap: 2, fontSize: '0.875rem' }}>
                    <span>{formatFileSize(item.size)}</span>
                    <span>Modified: {formatDate(item.modifiedTime)}</span>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton edge="end" onClick={(e) => {
                  e.stopPropagation();
                  if (multiSelectMode && selectedItems.size > 0 && !selectedItems.has(item.id)) {
                    // If in multi-select with selections, add this item to selection when menu is opened
                    setSelectedItems(prev => new Set(prev).add(item.id));
                  }
                  handleMenuOpen(e, item);
                }}>
                  <MoreVertIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
        )
      )}

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        {/* Bulk operations - shown when multiple items are selected */}
        {multiSelectMode && selectedItems.size > 1 && (
          <>
            <MenuItem onClick={() => {
              handleMenuClose();
              handleBulkMove();
            }}>
              <ListItemIcon>
                <DriveFileMoveIcon fontSize="small" />
              </ListItemIcon>
              Move
            </MenuItem>
            <MenuItem onClick={() => {
              handleMenuClose();
              handleBulkDelete();
            }}>
              <ListItemIcon>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              Move to Trash
            </MenuItem>
            <MenuItem onClick={() => {
              handleMenuClose();
              handleBulkDownload();
            }}>
              <ListItemIcon>
                <GetAppIcon fontSize="small" />
              </ListItemIcon>
              Download
            </MenuItem>
          </>
        )}
        
        {/* Single item operations - shown when only one item is selected or no multi-select */}
        {selectedItem && !viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Rename clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setRenameDialogOpen(true);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            Rename
          </MenuItem>
        )}
        
        {selectedItem && !viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Move clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setMoveDialogOpen(true);
            loadAvailableFolders(); // Load folders when menu item is clicked
            handleMenuClose();
          }}>
            <ListItemIcon>
              <DriveFileMoveIcon fontSize="small" />
            </ListItemIcon>
            Move
          </MenuItem>
        )}

        {selectedItem && !viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Share clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setShareDialogOpen(true);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <ShareIcon fontSize="small" />
            </ListItemIcon>
            Share
          </MenuItem>
        )}

        {selectedItem && !viewingTrash && !selectedItem.isFolder && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Copy to another account clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setCopyDialogOpen(true);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <FileCopyIcon fontSize="small" />
            </ListItemIcon>
            Copy to Account
          </MenuItem>
        )}

        {selectedItem && !viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Move to trash clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setDeleteConfirmOpen(true);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            Move to Trash
          </MenuItem>
        )}
        
        {selectedItem && viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Restore clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            handleRestoreItem();
            handleMenuClose();
          }}>
            <ListItemIcon>
              <RestoreFromTrashIcon fontSize="small" />
            </ListItemIcon>
            Restore
          </MenuItem>
        )}
        
        {selectedItem && viewingTrash && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Permanent Delete clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            setPermanentDeleteConfirmOpen(true);
            handleMenuClose();
          }}>
            <ListItemIcon>
              <DeleteForeverIcon fontSize="small" />
            </ListItemIcon>
            Delete Permanently
          </MenuItem>
        )}
        
        {selectedItem && !selectedItem.isFolder && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Preview clicked', item);
            setPreviewFile({
              fileId: item.id,
              fileName: item.name,
              fileUrl: `https://drive.google.com/file/d/${item.id}/view`,
              mimeType: item.mimeType,
              size: item.size,
              modifiedTime: item.modifiedTime,
              thumbnailLink: item.thumbnailLink,
              webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
              owners: item.owners,
            });
            handleMenuClose();
          }}>
            <ListItemIcon>
              <VisibilityIcon fontSize="small" />
            </ListItemIcon>
            Preview
          </MenuItem>
        )}
        
        {selectedItem && !selectedItem.isFolder && (!multiSelectMode || selectedItems.size <= 1) && (
          <MenuItem onClick={() => {
            // Store active item and proceed
            const item = selectedItem;
            debugLog('MENU: Download clicked', item);
            setActiveItem(item); // Make sure activeItem is updated
            handleDownloadItem();
            handleMenuClose();
          }}>
            <ListItemIcon>
              <GetAppIcon fontSize="small" />
            </ListItemIcon>
            Download
          </MenuItem>
        )}
      </Menu>
      
      {/* Rename Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Rename Item</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Name"
            type="text"
            fullWidth
            variant="standard"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            inputProps={{
              onFocus: (e) => {
                if (!newName && activeItem) {
                  setNewName(activeItem.name);
                }
                e.target.select();
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            debugLog('Rename dialog: Cancel clicked');
            setRenameDialogOpen(false);
          }} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={() => {
              debugLog('Rename dialog: Rename button clicked', { newName });
              handleRenameItem();
            }}
            color="primary"
            disabled={!newName || (activeItem ? newName === activeItem.name : false)}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Move to Trash</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to move "{activeItem?.name}" to trash?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteItem} 
            color="error"
          >
            Move to Trash
          </Button>
        </DialogActions>
      </Dialog>

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog
        open={permanentDeleteConfirmOpen}
        onClose={() => setPermanentDeleteConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Permanent Deletion</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to permanently delete "{activeItem?.name}"?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermanentDeleteConfirmOpen(false)} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={handlePermanentDelete} 
            color="error"
          >
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>

      {/* Move Item Dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Move Item{selectedItems.size > 1 ? 's' : ''}</DialogTitle>
        <DialogContent>
          <Typography gutterBottom sx={{ mb: 2 }}>
            {selectedItems.size > 1 
              ? `Move ${selectedItems.size} item(s) to:` 
              : `Move "${activeItem?.name}" to:`
            }
          </Typography>
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Destination Folder
            </Typography>
            <FolderTreeView
              folders={availableFolders}
              selectedId={moveTargetFolder || 'root'}
              onSelect={setMoveTargetFolder}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={selectedItems.size > 1 ? executeBulkMove : handleMoveItem} 
            color="primary"
            disabled={!moveTargetFolder}
          >
            Move
          </Button>
        </DialogActions>
      </Dialog>

      {/* Empty Trash Confirmation Dialog */}
      <Dialog
        open={emptyTrashConfirmOpen}
        onClose={() => setEmptyTrashConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Empty Trash</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to permanently delete all items in the trash? This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmptyTrashConfirmOpen(false)} color="primary">
            Cancel
          </Button>
          <Button 
            onClick={() => {
              // Use our dedicated function for emptying trash with progress
              handleEmptyTrashOperation({
                // Using an explicit type assertion to work around TypeScript errors
                // since this code needs significant refactoring to properly type
                // all these parameters
                setLoading,
                setSuccess,
                setError,
                loadTrash,
                setEmptyTrashConfirmOpen,
                onStorageUpdate,
                setEmptyTrashProgress
              } as any);
            }}
            color="error"
          >
            Empty Trash
          </Button>
        </DialogActions>
      </Dialog>

      {/* File Preview Dialog */}
      {previewFile && (
        <FilePreview
          open={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileId={previewFile.fileId}
          fileName={previewFile.fileName}
          fileUrl={previewFile.fileUrl}
          mimeType={previewFile.mimeType}
          fileSize={previewFile.size}
          modifiedTime={previewFile.modifiedTime}
          thumbnailLink={previewFile.thumbnailLink}
          webViewLink={previewFile.webViewLink}
          owners={previewFile.owners}
        />
      )}

      {/* Share Dialog */}
      {activeItem && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          fileId={activeItem.id}
          filename={activeItem.name}
          isFolder={activeItem.isFolder}
        />
      )}

      {/* Copy to Account Dialog */}
      <Dialog 
        open={copyDialogOpen} 
        onClose={() => setCopyDialogOpen(false)} 
        fullWidth 
        maxWidth="sm"
      >
        <DialogTitle>Copy "{activeItem?.name}" to another account</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Destination Account</InputLabel>
              <Select
                value={copyDestinationAccount}
                label="Destination Account"
                onChange={(e) => setCopyDestinationAccount(e.target.value)}
              >
                {accounts.length === 0 ? (
                  <MenuItem disabled>No other accounts available</MenuItem>
                ) : (
                  accounts.map((acc) => (
                    <MenuItem key={acc.id} value={acc.id}>
                      {acc.email}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Destination Folder
              </Typography>
              <FolderTreeView
                folders={destinationFolders}
                selectedId={copyDestinationFolder || 'root'}
                onSelect={setCopyDestinationFolder}
                disabled={!copyDestinationAccount}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCopyItem} 
            variant="contained" 
            disabled={!copyDestinationAccount || loading}
          >
            {loading ? 'Copying...' : 'Copy Here'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Copy Progress Dialog */}
      <Dialog
        open={copyProgress.visible}
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown
        PaperProps={{
          sx: {
            borderRadius: 3,
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            maxWidth: 450,
            m: 2
          }
        }}
      >
        <Box sx={{ p: 3 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <FileCopyIcon sx={{ fontSize: 24, color: 'text.primary' }} />
              <Typography variant="h6" sx={{ fontWeight: 500, fontSize: '1.125rem' }}>
                Copying File...
              </Typography>
            </Box>
            {copyProgress.percentComplete < 100 && (
              <Button
                onClick={handleCancelCopy}
                variant="outlined"
                size="small"
                color="inherit"
                sx={{ 
                  borderColor: 'divider',
                  color: 'text.primary',
                  textTransform: 'none',
                  '&:hover': {
                    borderColor: 'text.primary',
                    bgcolor: 'action.hover'
                  }
                }}
              >
                Cancel
              </Button>
            )}
          </Box>

          {/* File Name */}
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 2,
            bgcolor: 'action.hover',
            borderRadius: 2,
            mb: 3
          }}>
            <InsertDriveFileIcon sx={{ fontSize: 24, color: 'primary.main' }} />
            <Typography 
              variant="body1" 
              sx={{ 
                fontWeight: 500,
                wordBreak: 'break-word',
                flex: 1
              }}
            >
              {copyProgress.fileName}
            </Typography>
          </Box>

          {/* Status and Percentage */}
          <Box sx={{ 
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1.5
          }}>
            <Typography 
              variant="body2" 
              sx={{ 
                color: 'text.secondary',
                fontSize: '0.875rem'
              }}
            >
              {copyProgress.percentComplete === 100 ? (
                'Completed'
              ) : copyProgress.bytesTransferred === 0 ? (
                'Preparing...'
              ) : (
                `Copying to "${copyProgress.destinationFolderName}"`
              )}
            </Typography>
            <Chip 
              label={`${copyProgress.percentComplete}%`}
              size="small"
              sx={{ 
                height: 24,
                fontWeight: 600,
                fontSize: '0.75rem',
                bgcolor: copyProgress.percentComplete === 100 ? 'success.main' : 'primary.main',
                color: 'white',
                minWidth: 56,
                borderRadius: 3,
                '& .MuiChip-label': { px: 1.5 }
              }}
            />
          </Box>

          {/* Progress Bar */}
          <Box sx={{ 
            height: 6,
            bgcolor: 'action.hover',
            borderRadius: 3,
            overflow: 'hidden',
            mb: 3
          }}>
            <Box
              sx={{
                height: '100%',
                width: `${copyProgress.percentComplete}%`,
                bgcolor: copyProgress.percentComplete === 100 ? 'success.main' : 'primary.main',
                transition: 'width 0.3s ease, background-color 0.3s ease',
                borderRadius: 3
              }}
            />
          </Box>

          {/* Transfer Stats */}
          <Box sx={{ 
            display: 'flex',
            p: 2.5,
            bgcolor: 'action.hover',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider'
          }}>
            <Box sx={{ flex: 1 }}>
              <Typography 
                variant="caption"
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  display: 'block',
                  mb: 0.5
                }}
              >
                Transferred
              </Typography>
              <Typography 
                variant="h6" 
                sx={{ 
                  fontWeight: 600,
                  fontSize: '1rem',
                  color: 'text.primary'
                }}
              >
                {formatFileSize(copyProgress.bytesTransferred)}
              </Typography>
            </Box>
            
            <Box sx={{ flex: 1 }}>
              <Typography 
                variant="caption"
                sx={{ 
                  color: 'text.secondary',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  display: 'block',
                  mb: 0.5
                }}
              >
                Total Size
              </Typography>
              <Typography 
                variant="h6" 
                sx={{ 
                  fontWeight: 600,
                  fontSize: '1rem',
                  color: 'text.primary'
                }}
              >
                {formatFileSize(copyProgress.totalBytes)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}
