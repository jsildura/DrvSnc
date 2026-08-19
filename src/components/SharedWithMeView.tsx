import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Chip,
  CircularProgress,
  Button,
  Tooltip,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SortIcon from '@mui/icons-material/Sort';
import CheckIcon from '@mui/icons-material/Check';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import GetAppIcon from '@mui/icons-material/GetApp';
import VisibilityIcon from '@mui/icons-material/Visibility';
import FileCopyIcon from '@mui/icons-material/FileCopy';

interface SharedItem {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  createdTime: string;
  sharedWithMeTime: string;
  viewedByMeTime?: string;
  modifiedByMeTime?: string;
  iconLink: string;
  isFolder: boolean;
  shared: boolean;
  sharedWithMe: boolean;
  owners: any[];
  ownerEmail: string;
  ownerDisplayName: string;
  ownerPhotoLink: string;
  sharingUser: any;
  sharingUserEmail: string;
  sharingUserDisplayName: string;
  sharingUserPhotoLink: string;
}

type SortField = 'dateShared' | 'name' | 'dateModified' | 'dateModifiedByMe' | 'dateOpenedByMe';
type SortDirection = 'asc' | 'desc';

interface SharedWithMeViewProps {
  onError: (error: string) => void;
  onSuccess: (message: string) => void;
  onNavigate?: (item: SharedItem) => void;
}

export default function SharedWithMeView({ onError, onSuccess, onNavigate }: SharedWithMeViewProps) {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('dateShared');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [sortMenuAnchor, setSortMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedItem, setSelectedItem] = useState<SharedItem | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [pageTokenHistory, setPageTokenHistory] = useState<(string | undefined)[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  useEffect(() => {
    loadSharedItems();
    setPageTokenHistory([undefined]); // Initialize with first page (no token)
    setCurrentPageIndex(0);
  }, []);

  const handleNextPage = () => {
    if (!nextPageToken) return;
    
    const newIndex = currentPageIndex + 1;
    const newHistory = [...pageTokenHistory.slice(0, newIndex + 1), nextPageToken];
    setPageTokenHistory(newHistory);
    setCurrentPageIndex(newIndex);
    loadSharedItems(nextPageToken);
  };

  const handlePreviousPage = () => {
    if (currentPageIndex === 0) return;
    
    const newIndex = currentPageIndex - 1;
    setCurrentPageIndex(newIndex);
    loadSharedItems(pageTokenHistory[newIndex]);
  };

  const loadSharedItems = async (pageToken?: string) => {
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ 
        type: 'LIST_SHARED_WITH_ME',
        payload: { pageToken }
      });
      
      // Handle new paginated response structure
      if (response && typeof response === 'object' && 'items' in response) {
        setItems(Array.isArray(response.items) ? response.items : []);
        setNextPageToken(response.nextPageToken);
      } else if (Array.isArray(response)) {
        // Fallback for old format
        setItems(response);
        setNextPageToken(undefined);
      } else {
        console.warn('[SharedWithMeView] Invalid response format:', response);
        setItems([]);
        setNextPageToken(undefined);
      }
    } catch (error: any) {
      console.error('[SharedWithMeView] Error loading shared items:', error);
      onError(`Failed to load shared items: ${error.message}`);
      setItems([]);
      setNextPageToken(undefined);
    } finally {
      setLoading(false);
    }
  };

  // Sort items
  const sortedItems = useMemo(() => {
    // Ensure items is an array before sorting
    if (!Array.isArray(items)) {
      console.warn('[SharedWithMeView] Items is not an array:', items);
      return [];
    }
    
    const sorted = [...items];

    // Always sort folders first
    sorted.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      
      // Then sort by selected field
      let comparison = 0;
      
      switch (sortField) {
        case 'dateShared':
          // Use sharedWithMeTime if available, otherwise fall back to createdTime
          const aSharedTime = a.sharedWithMeTime ? new Date(a.sharedWithMeTime).getTime() : new Date(a.createdTime).getTime();
          const bSharedTime = b.sharedWithMeTime ? new Date(b.sharedWithMeTime).getTime() : new Date(b.createdTime).getTime();
          comparison = aSharedTime - bSharedTime;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'dateModified':
          comparison = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
          break;
        case 'dateModifiedByMe':
          const aModByMe = a.modifiedByMeTime ? new Date(a.modifiedByMeTime).getTime() : 0;
          const bModByMe = b.modifiedByMeTime ? new Date(b.modifiedByMeTime).getTime() : 0;
          comparison = aModByMe - bModByMe;
          break;
        case 'dateOpenedByMe':
          const aOpened = a.viewedByMeTime ? new Date(a.viewedByMeTime).getTime() : 0;
          const bOpened = b.viewedByMeTime ? new Date(b.viewedByMeTime).getTime() : 0;
          comparison = aOpened - bOpened;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [items, sortField, sortDirection]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '—';
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    if (kb >= 1) return `${kb.toFixed(2)} KB`;
    return `${bytes} bytes`;
  };

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc'); // Default to descending for new field
    }
    setSortMenuAnchor(null);
  };

  const handleItemMenu = (event: React.MouseEvent<HTMLElement>, item: SharedItem) => {
    event.stopPropagation();
    setSelectedItem(item);
    setMenuAnchor(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setSelectedItem(null);
  };

  const handleDownload = async () => {
    if (!selectedItem) return;
    
    try {
      const fileUrl = await chrome.runtime.sendMessage({
        type: 'GET_FILE_DOWNLOAD_URL',
        payload: { fileId: selectedItem.id }
      });
      
      chrome.downloads.download({
        url: fileUrl,
        filename: selectedItem.name
      });
      
      onSuccess(`Downloading ${selectedItem.name}`);
    } catch (error: any) {
      onError(`Failed to download: ${error.message}`);
    } finally {
      handleMenuClose();
    }
  };

  const handleOpenInDrive = () => {
    if (!selectedItem) return;
    
    const url = `https://drive.google.com/file/d/${selectedItem.id}/view`;
    chrome.tabs.create({ url });
    handleMenuClose();
  };

  const handleItemClick = (item: SharedItem) => {
    if (onNavigate) {
      onNavigate(item);
    } else {
      // Fallback: Open in Google Drive if no navigation handler
      const url = `https://drive.google.com/file/d/${item.id}/view`;
      chrome.tabs.create({ url });
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          No items shared with you
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          When someone shares files or folders with you, they will appear here.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Shared with me</Typography>
        
        {/* Sort Button */}
        <Button
          startIcon={<SortIcon />}
          endIcon={sortDirection === 'asc' ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
          onClick={(e) => setSortMenuAnchor(e.currentTarget)}
          size="small"
          variant="outlined"
        >
          Sort
        </Button>
      </Box>

      {/* Sort Menu */}
      <Menu
        anchorEl={sortMenuAnchor}
        open={Boolean(sortMenuAnchor)}
        onClose={() => setSortMenuAnchor(null)}
      >
        <MenuItem disabled>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Sort by
          </Typography>
        </MenuItem>
        <MenuItem onClick={() => handleSortChange('dateShared')}>
          {sortField === 'dateShared' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortField === 'dateShared' ? 0 : 3.5 }}>Date shared</Typography>
        </MenuItem>
        <MenuItem onClick={() => handleSortChange('name')}>
          {sortField === 'name' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortField === 'name' ? 0 : 3.5 }}>Name</Typography>
        </MenuItem>
        <MenuItem onClick={() => handleSortChange('dateModified')}>
          {sortField === 'dateModified' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortField === 'dateModified' ? 0 : 3.5 }}>Date modified</Typography>
        </MenuItem>
        <MenuItem onClick={() => handleSortChange('dateModifiedByMe')}>
          {sortField === 'dateModifiedByMe' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortField === 'dateModifiedByMe' ? 0 : 3.5 }}>Date modified by me</Typography>
        </MenuItem>
        <MenuItem onClick={() => handleSortChange('dateOpenedByMe')}>
          {sortField === 'dateOpenedByMe' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortField === 'dateOpenedByMe' ? 0 : 3.5 }}>Date opened by me</Typography>
        </MenuItem>
        
        <MenuItem disabled>
          <Typography variant="caption" sx={{ fontWeight: 600, mt: 1 }}>
            Sort direction
          </Typography>
        </MenuItem>
        <MenuItem onClick={() => { setSortDirection('desc'); setSortMenuAnchor(null); }}>
          {sortDirection === 'desc' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortDirection === 'desc' ? 0 : 3.5 }}>New to old</Typography>
        </MenuItem>
        <MenuItem onClick={() => { setSortDirection('asc'); setSortMenuAnchor(null); }}>
          {sortDirection === 'asc' && <CheckIcon fontSize="small" sx={{ mr: 1 }} />}
          <Typography sx={{ ml: sortDirection === 'asc' ? 0 : 3.5 }}>Old to new</Typography>
        </MenuItem>
      </Menu>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Shared by</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Date shared</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 48 }}></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.isArray(sortedItems) && sortedItems.map((item) => (
              <TableRow 
                key={item.id} 
                hover 
                onClick={() => handleItemClick(item)}
                sx={{ 
                  '&:hover': { bgcolor: 'action.hover' },
                  cursor: 'pointer'
                }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {item.isFolder ? (
                      <FolderIcon sx={{ color: '#F9AB00' }} />
                    ) : item.iconLink ? (
                      <img src={item.iconLink} alt="" width={20} height={20} />
                    ) : (
                      <InsertDriveFileIcon sx={{ color: 'text.secondary' }} />
                    )}
                    <Typography variant="body2">{item.name}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {item.sharingUserPhotoLink ? (
                      <Avatar 
                        src={item.sharingUserPhotoLink} 
                        sx={{ width: 24, height: 24 }}
                      />
                    ) : (
                      <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                        {(item.sharingUserDisplayName || item.sharingUserEmail || '?')[0].toUpperCase()}
                      </Avatar>
                    )}
                    <Tooltip title={item.sharingUserEmail}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {item.sharingUserDisplayName || item.sharingUserEmail}
                      </Typography>
                    </Tooltip>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {formatDate(item.sharedWithMeTime || item.createdTime)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={(e) => handleItemMenu(e, item)}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination Controls */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
        <Button
          onClick={handlePreviousPage}
          disabled={currentPageIndex === 0}
          variant="outlined"
          size="small"
        >
          Previous
        </Button>
        
        <Typography variant="body2" color="text.secondary">
          Page {currentPageIndex + 1}
        </Typography>
        
        <Button
          onClick={handleNextPage}
          disabled={!nextPageToken}
          variant="outlined"
          size="small"
        >
          Next
        </Button>
      </Box>

      {/* Item Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleOpenInDrive}>
          <ListItemIcon>
            <VisibilityIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Open in Google Drive</ListItemText>
        </MenuItem>
        {selectedItem && !selectedItem.isFolder && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon>
              <GetAppIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
