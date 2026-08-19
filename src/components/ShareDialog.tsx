import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Typography,
  Box,
  Avatar,
  IconButton,
  Chip,
  Select,
  MenuItem,
  FormControl,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Alert,
  CircularProgress,
  Menu,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import PublicIcon from '@mui/icons-material/Public';
import LockIcon from '@mui/icons-material/Lock';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import CheckIcon from '@mui/icons-material/Check';
import {
  getFilePermissions,
  addPermission,
  updatePermission,
  removePermission,
  setPublicAccess,
} from '../lib/drive';
import { getValidToken } from '../lib/auth';
import type { Permission } from '../lib/types';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  filename: string;
  isFolder?: boolean;
}

export default function ShareDialog({ open, onClose, fileId, filename, isFolder = false }: ShareDialogProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [generalAccess, setGeneralAccess] = useState<'restricted' | 'anyone'>('restricted');
  const [generalAccessRole, setGeneralAccessRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [emailInput, setEmailInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [roleMenuAnchor, setRoleMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedPermission, setSelectedPermission] = useState<Permission | null>(null);

  useEffect(() => {
    if (open && fileId) {
      loadPermissions();
    }
  }, [open, fileId]);

  const loadPermissions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { driveTokens } = await chrome.storage.local.get('driveTokens');
      const token = await getValidToken(driveTokens);
      const perms = await getFilePermissions(token, fileId);
      
      setPermissions(perms);
      
      // Check if file has public access
      const anyonePermission = perms.find(p => p.type === 'anyone');
      if (anyonePermission) {
        setGeneralAccess('anyone');
        setGeneralAccessRole(anyonePermission.role as any);
      } else {
        setGeneralAccess('restricted');
      }
    } catch (err: any) {
      console.error('Failed to load permissions:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPerson = async () => {
    if (!emailInput.trim()) return;

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setError(null);
      const { driveTokens } = await chrome.storage.local.get('driveTokens');
      const token = await getValidToken(driveTokens);
      
      const newPermission = await addPermission(token, fileId, emailInput.trim(), 'reader');
      setPermissions([...permissions, newPermission]);
      setEmailInput('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGeneralAccessChange = async (access: 'restricted' | 'anyone') => {
    try {
      setError(null);
      const { driveTokens } = await chrome.storage.local.get('driveTokens');
      const token = await getValidToken(driveTokens);

      if (access === 'anyone') {
        // Create public permission
        const newPermission = await setPublicAccess(token, fileId, generalAccessRole);
        setPermissions([...permissions, newPermission]);
        setGeneralAccess('anyone');
      } else {
        // Remove public permission
        const anyonePermission = permissions.find(p => p.type === 'anyone');
        if (anyonePermission) {
          await removePermission(token, fileId, anyonePermission.id);
          setPermissions(permissions.filter(p => p.id !== anyonePermission.id));
        }
        setGeneralAccess('restricted');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRoleChangeClick = (event: React.MouseEvent<HTMLElement>, permission: Permission) => {
    setRoleMenuAnchor(event.currentTarget);
    setSelectedPermission(permission);
  };

  const handleRoleMenuClose = () => {
    setRoleMenuAnchor(null);
    setSelectedPermission(null);
  };

  const handleRoleChange = async (newRole: 'reader' | 'commenter' | 'writer') => {
    if (!selectedPermission) return;

    try {
      setError(null);
      const { driveTokens } = await chrome.storage.local.get('driveTokens');
      const token = await getValidToken(driveTokens);
      
      if (selectedPermission.type === 'anyone') {
        // For general access, remove old and create new
        await removePermission(token, fileId, selectedPermission.id);
        const newPermission = await setPublicAccess(token, fileId, newRole);
        setPermissions(permissions.map(p => p.id === selectedPermission.id ? newPermission : p));
        setGeneralAccessRole(newRole);
      } else {
        // For user permissions, update role
        const updatedPermission = await updatePermission(token, fileId, selectedPermission.id, newRole);
        // Merge with existing permission to preserve displayName, emailAddress, photoLink
        setPermissions(permissions.map(p => 
          p.id === selectedPermission.id 
            ? { ...p, ...updatedPermission, role: updatedPermission.role }
            : p
        ));
      }
      
      handleRoleMenuClose();
    } catch (err: any) {
      setError(err.message);
      handleRoleMenuClose();
    }
  };

  const handleRemovePermission = async (permissionId: string) => {
    try {
      setError(null);
      const { driveTokens } = await chrome.storage.local.get('driveTokens');
      const token = await getValidToken(driveTokens);
      await removePermission(token, fileId, permissionId);
      setPermissions(permissions.filter(p => p.id !== permissionId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCopyLink = async () => {
    const linkToCopy = `https://drive.google.com/file/d/${fileId}/view`;
    await navigator.clipboard.writeText(linkToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return 'Owner';
      case 'writer': return 'Editor';
      case 'commenter': return 'Commenter';
      case 'reader': return 'Viewer';
      default: return role;
    }
  };

  const userPermissions = permissions.filter(p => p.type === 'user' || p.type === 'group');
  const anyonePermission = permissions.find(p => p.type === 'anyone');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Share "{filename}"</Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {/* Add people input */}
              <TextField
                fullWidth
                size="small"
                placeholder="Add people"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddPerson()}
                InputProps={{
                  endAdornment: emailInput && (
                    <IconButton size="small" onClick={handleAddPerson}>
                      <PersonAddIcon />
                    </IconButton>
                  ),
                }}
              />

              {/* People with access */}
              {userPermissions.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, fontSize: '0.875rem' }}>
                    People with access
                  </Typography>
                  <List dense disablePadding>
                    {userPermissions.map((permission) => (
                      <ListItem key={permission.id} sx={{ px: 0 }}>
                        <ListItemAvatar>
                          <Avatar 
                            src={permission.photoLink} 
                            sx={{ width: 32, height: 32, fontSize: '0.875rem' }}
                          >
                            {(permission.displayName?.[0] || permission.emailAddress?.[0] || '?').toUpperCase()}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={
                            <Typography variant="body2">
                              {permission.displayName || permission.emailAddress}
                              {permission.role === 'owner' && ' (you)'}
                            </Typography>
                          }
                          secondary={
                            <Typography variant="caption" color="text.secondary">
                              {permission.emailAddress}
                            </Typography>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {permission.role === 'owner' ? (
                              <Chip label="Owner" size="small" variant="outlined" />
                            ) : (
                              <>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={(e) => handleRoleChangeClick(e, permission)}
                                  sx={{ textTransform: 'none', minWidth: 'auto', px: 1 }}
                                >
                                  {getRoleLabel(permission.role)}
                                </Button>
                                <IconButton size="small" onClick={() => handleRemovePermission(permission.id)}>
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </>
                            )}
                          </Stack>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}

              <Divider />

              {/* General access */}
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600, fontSize: '0.875rem' }}>
                  General access
                </Typography>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Box sx={{ mt: 0.5 }}>
                    {generalAccess === 'restricted' ? (
                      <LockIcon color="action" fontSize="small" />
                    ) : (
                      <PublicIcon color="success" fontSize="small" />
                    )}
                  </Box>
                  <Box sx={{ flexGrow: 1 }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <FormControl size="small" sx={{ minWidth: 180 }}>
                        <Select
                          value={generalAccess}
                          onChange={(e) => handleGeneralAccessChange(e.target.value as any)}
                        >
                          <MenuItem value="restricted">Restricted</MenuItem>
                          <MenuItem value="anyone">Anyone with the link</MenuItem>
                        </Select>
                      </FormControl>
                      {generalAccess === 'anyone' && (
                        <Button
                          size="small"
                          variant="text"
                          onClick={(e) => anyonePermission && handleRoleChangeClick(e, anyonePermission)}
                          sx={{ textTransform: 'none' }}
                        >
                          {getRoleLabel(generalAccessRole)}
                        </Button>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {generalAccess === 'restricted'
                        ? `Only people with access can open with the link`
                        : `Anyone on the internet with the link can ${generalAccessRole === 'writer' ? 'edit' : generalAccessRole === 'commenter' ? 'comment' : 'view'}`}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              {/* Copy link button */}
              {generalAccess === 'anyone' && (
                <Button
                  variant="outlined"
                  startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
                  onClick={handleCopyLink}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {copied ? 'Link copied' : 'Copy link'}
                </Button>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>

      {/* Role selection menu */}
      <Menu
        anchorEl={roleMenuAnchor}
        open={Boolean(roleMenuAnchor)}
        onClose={handleRoleMenuClose}
      >
        <MenuItem disabled sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
          ROLE
        </MenuItem>
        <MenuItem onClick={() => handleRoleChange('reader')}>
          <Stack>
            <Typography variant="body2">Viewer</Typography>
            <Typography variant="caption" color="text.secondary">
              Can view
            </Typography>
          </Stack>
        </MenuItem>
        <MenuItem onClick={() => handleRoleChange('commenter')}>
          <Stack>
            <Typography variant="body2">Commenter</Typography>
            <Typography variant="caption" color="text.secondary">
              Can comment
            </Typography>
          </Stack>
        </MenuItem>
        <MenuItem onClick={() => handleRoleChange('writer')}>
          <Stack>
            <Typography variant="body2">Editor</Typography>
            <Typography variant="caption" color="text.secondary">
              Organize, add, and edit files
            </Typography>
          </Stack>
        </MenuItem>
      </Menu>
    </Dialog>
  );
}
