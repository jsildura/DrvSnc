import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  TextField,
  IconButton,
  InputAdornment,
  Select,
  MenuItem,
  FormControl,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Typography,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderIcon from '@mui/icons-material/Folder';
import ImageIcon from '@mui/icons-material/Image';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ArticleIcon from '@mui/icons-material/Article';
import TableChartIcon from '@mui/icons-material/TableChart';
import CloseIcon from '@mui/icons-material/Close';

interface SearchComponentProps {
  onSearch: (searchParams: SearchParams) => void;
  onClear: () => void;
}

export interface SearchParams {
  query: string;
  fileType: string;
  dateModified?: string;
  owner?: string;
  searchLocation: 'all' | 'myDrive' | 'sharedWithMe';
}

const fileTypes = [
  { value: 'all', label: 'Any type', icon: <DescriptionIcon fontSize="small" /> },
  { value: 'folder', label: 'Folders', mimeType: 'application/vnd.google-apps.folder', icon: <FolderIcon fontSize="small" /> },
  { value: 'pdf', label: 'PDFs', mimeType: 'application/pdf', icon: <PictureAsPdfIcon fontSize="small" /> },
  { value: 'image', label: 'Images', mimeType: 'image/', icon: <ImageIcon fontSize="small" /> },
  { value: 'video', label: 'Videos', mimeType: 'video/', icon: <VideoLibraryIcon fontSize="small" /> },
  { value: 'document', label: 'Google Docs', mimeType: 'application/vnd.google-apps.document', icon: <ArticleIcon fontSize="small" /> },
  { value: 'spreadsheet', label: 'Google Sheets', mimeType: 'application/vnd.google-apps.spreadsheet', icon: <TableChartIcon fontSize="small" /> },
  { value: 'presentation', label: 'Google Slides', mimeType: 'application/vnd.google-apps.presentation', icon: <DescriptionIcon fontSize="small" /> },
];

const dateOptions = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'thisYear', label: 'This year' },
];

export default function SearchComponent({ onSearch, onClear }: SearchComponentProps) {
  const [query, setQuery] = useState('');
  const [fileType, setFileType] = useState('all');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dateModified, setDateModified] = useState('');
  const [searchLocation, setSearchLocation] = useState<'all' | 'myDrive' | 'sharedWithMe'>('all');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Generate search suggestions based on input (debounced for performance)
  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce suggestion generation by 300ms
    debounceTimerRef.current = setTimeout(() => {
      if (query.length > 0) {
        const newSuggestions: string[] = [];
        
        // Add query suggestions
        newSuggestions.push(query);
        
        // Add type-specific suggestions
        if (fileType !== 'all') {
          const selectedType = fileTypes.find(t => t.value === fileType);
          newSuggestions.push(`type:${fileType}`);
        }
        
        // Add common search operators
        if (query.length > 2) {
          newSuggestions.push(`${query} type:pdf`);
          newSuggestions.push(`${query} type:folder`);
        }
        
        setSuggestions(newSuggestions.slice(0, 5));
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300) as unknown as number;

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, fileType]);

  const handleSearch = (searchQuery?: string) => {
    const finalQuery = searchQuery || query;
    if (!finalQuery.trim() && fileType === 'all' && !dateModified) return;

    setIsSearchActive(true);
    setShowSuggestions(false);
    
    onSearch({
      query: finalQuery,
      fileType,
      dateModified,
      searchLocation,
    });
  };

  const handleClear = () => {
    setQuery('');
    setFileType('all');
    setDateModified('');
    setSearchLocation('all');
    setIsSearchActive(false);
    setShowSuggestions(false);
    onClear();
  };

  const handleAdvancedSearch = () => {
    setAdvancedOpen(false);
    handleSearch();
  };

  const selectedFileType = fileTypes.find(t => t.value === fileType);

  return (
    <>
      <Box ref={searchRef} sx={{ position: 'relative' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            p: 2,
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flexGrow: 1, position: 'relative' }}>
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Search in Drive"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              onFocus={() => query.length > 0 && setShowSuggestions(true)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                endAdornment: isSearchActive && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={handleClear}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
                sx: { borderRadius: 3, bgcolor: 'action.hover' },
              }}
            />

            {/* Search Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <Paper
                elevation={8}
                sx={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  mt: 0.5,
                  maxHeight: 300,
                  overflow: 'auto',
                  zIndex: 1300,
                  borderRadius: 2,
                }}
              >
                <List dense>
                  {suggestions.map((suggestion, index) => (
                    <ListItem
                      key={index}
                      button
                      onClick={() => {
                        setQuery(suggestion);
                        handleSearch(suggestion);
                      }}
                      sx={{
                        '&:hover': {
                          bgcolor: 'action.hover',
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <SearchIcon fontSize="small" color="action" />
                      </ListItemIcon>
                      <ListItemText primary={suggestion} />
                    </ListItem>
                  ))}
                  <Divider />
                  <ListItem
                    button
                    onClick={() => setAdvancedOpen(true)}
                    sx={{ color: 'primary.main' }}
                  >
                    <ListItemText 
                      primary="Advanced search" 
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    />
                  </ListItem>
                </List>
              </Paper>
            )}
          </Box>

          <FormControl sx={{ minWidth: 140 }}>
            <Select
              value={fileType}
              onChange={(e) => setFileType(e.target.value)}
              displayEmpty
              renderValue={(value) => {
                const selected = fileTypes.find(t => t.value === value);
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {selected?.icon}
                    <Typography variant="body2">{selected?.label}</Typography>
                  </Box>
                );
              }}
              sx={{ borderRadius: 3, bgcolor: 'action.hover' }}
            >
              {fileTypes.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    {type.icon}
                    {type.label}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <IconButton
            onClick={() => setAdvancedOpen(true)}
            sx={{
              bgcolor: 'action.hover',
              '&:hover': { bgcolor: 'action.selected' },
            }}
          >
            <TuneIcon />
          </IconButton>
        </Box>

        {/* Active Filters Display */}
        {isSearchActive && (query || fileType !== 'all' || dateModified) && (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover' }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Active filters:
            </Typography>
            {query && (
              <Chip
                size="small"
                label={`Query: "${query}"`}
                onDelete={() => {
                  setQuery('');
                  handleSearch();
                }}
              />
            )}
            {fileType !== 'all' && (
              <Chip
                size="small"
                label={`Type: ${selectedFileType?.label}`}
                onDelete={() => {
                  setFileType('all');
                  handleSearch();
                }}
              />
            )}
            {dateModified && (
              <Chip
                size="small"
                label={`Date: ${dateOptions.find(d => d.value === dateModified)?.label}`}
                onDelete={() => {
                  setDateModified('');
                  handleSearch();
                }}
              />
            )}
            <Button size="small" onClick={handleClear}>
              Clear all
            </Button>
          </Box>
        )}
      </Box>

      {/* Advanced Search Dialog */}
      <Dialog
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Advanced Search
          <IconButton
            onClick={() => setAdvancedOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Search query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter keywords..."
              />
            </Grid>

            <Grid item xs={12}>
              <FormControl fullWidth>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                  File type
                </Typography>
                <Select
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                  displayEmpty
                >
                  {fileTypes.map((type) => (
                    <MenuItem key={type.value} value={type.value}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {type.icon}
                        {type.label}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <FormControl fullWidth>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                  Date modified
                </Typography>
                <Select
                  value={dateModified}
                  onChange={(e) => setDateModified(e.target.value)}
                  displayEmpty
                >
                  {dateOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <FormControl fullWidth>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                  Location
                </Typography>
                <Select
                  value={searchLocation}
                  onChange={(e) => setSearchLocation(e.target.value as any)}
                >
                  <MenuItem value="all">Anywhere</MenuItem>
                  <MenuItem value="myDrive">My Drive</MenuItem>
                  <MenuItem value="sharedWithMe">Shared with me</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAdvancedOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdvancedSearch}>
            Search
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
