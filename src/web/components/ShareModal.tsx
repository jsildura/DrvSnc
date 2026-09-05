import React, { useState, useEffect, useRef } from 'react';
import { DriveItemView, PermissionView } from '../../shared/contracts';
import {
  getPermissions,
  addPermission,
  updatePermission,
  removePermission,
} from '../api/drive';
import { useOptionalApp } from '../state/AppProvider';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: DriveItemView | null;
  onPermissionChanged?: () => void;
}

type GeneralAccessType = 'restricted' | 'anyone';
type RoleType = 'reader' | 'commenter' | 'writer';

function getRoleLabel(role: string): string {
  switch (role) {
    case 'writer':
      return 'Editor';
    case 'commenter':
      return 'Commenter';
    case 'reader':
    default:
      return 'Viewer';
  }
}

export default function ShareModal({
  isOpen,
  onClose,
  item,
  onPermissionChanged,
}: ShareModalProps) {
  const { user } = useOptionalApp() || {};
  const [permissions, setPermissions] = useState<PermissionView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add person state
  const [emailInput, setEmailInput] = useState('');
  const [newPersonRole, setNewPersonRole] = useState<RoleType>('reader');
  const [isAddingPerson, setIsAddingPerson] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Staged General Access state (only committed when clicking Done)
  const [initialGeneralAccess, setInitialGeneralAccess] = useState<GeneralAccessType>('restricted');
  const [initialGeneralRole, setInitialGeneralRole] = useState<RoleType>('reader');
  const [stagedGeneralAccess, setStagedGeneralAccess] = useState<GeneralAccessType>('restricted');
  const [stagedGeneralRole, setStagedGeneralRole] = useState<RoleType>('reader');
  const [isSaving, setIsSaving] = useState(false);

  // Dropdown states
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && item) {
      loadPermissions(item.id);
      setEmailInput('');
      setOpenDropdownId(null);
      setCopiedLink(false);
    }
  }, [isOpen, item]);

  // Click outside to close any open dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (openDropdownId) {
        const target = event.target as HTMLElement;
        if (!target.closest('[data-share-dropdown]')) {
          setOpenDropdownId(null);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdownId]);

  if (!isOpen || !item) return null;

  const loadPermissions = async (fileId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const perms = await getPermissions(fileId);
      const list = perms || [];
      setPermissions(list);

      const serverAnyone = list.find((p) => p.type === 'anyone');
      const access: GeneralAccessType = serverAnyone ? 'anyone' : 'restricted';
      const role: RoleType = (serverAnyone?.role as RoleType) || 'reader';

      setInitialGeneralAccess(access);
      setInitialGeneralRole(role);
      setStagedGeneralAccess(access);
      setStagedGeneralRole(role);
    } catch (err: any) {
      console.error('Failed to load permissions:', err);
      setError(err?.message || 'Failed to load permissions');
    } finally {
      setIsLoading(false);
    }
  };

  // Server anyone permission (if exists)
  const anyonePerm = permissions.find((p) => p.type === 'anyone');

  // Collaborators with access (type !== 'anyone')
  const peopleWithAccess = permissions.filter((p) => p.type !== 'anyone');

  // Check if owner is already in the list
  const hasExplicitOwner = peopleWithAccess.some((p) => p.role === 'owner');

  const shareTargetId = item.targetId || item.id;
  const shareLink =
    item.webViewLink ||
    (item.isFolder
      ? `https://drive.google.com/drive/folders/${shareTargetId}`
      : `https://drive.google.com/file/d/${shareTargetId}/view`);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleAddPerson = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setIsAddingPerson(true);
      setError(null);
      const newPerm = await addPermission(item.id, newPersonRole, 'user', email);
      setPermissions((prev) => [...prev, newPerm]);
      setEmailInput('');
      setIsInputFocused(false);
      onPermissionChanged?.();
    } catch (err: any) {
      console.error('Failed to add person:', err);
      setError(err?.message || 'Failed to add person');
    } finally {
      setIsAddingPerson(false);
    }
  };

  const handleUpdateRole = async (permissionId: string, newRole: RoleType) => {
    try {
      setError(null);
      setOpenDropdownId(null);
      const updated = await updatePermission(item.id, permissionId, newRole);
      setPermissions((prev) =>
        prev.map((p) => (p.id === permissionId ? updated : p))
      );
      onPermissionChanged?.();
    } catch (err: any) {
      console.error('Failed to update role:', err);
      setError(err?.message || 'Failed to update permission role');
    }
  };

  const handleRemovePermission = async (permissionId: string) => {
    try {
      setError(null);
      setOpenDropdownId(null);
      await removePermission(item.id, permissionId);
      setPermissions((prev) => prev.filter((p) => p.id !== permissionId));
      onPermissionChanged?.();
    } catch (err: any) {
      console.error('Failed to remove permission:', err);
      setError(err?.message || 'Failed to remove permission');
    }
  };

  const handleToggleGeneralAccess = (access: GeneralAccessType) => {
    setOpenDropdownId(null);
    setStagedGeneralAccess(access);
  };

  const handleGeneralRoleChange = (role: RoleType) => {
    setOpenDropdownId(null);
    setStagedGeneralRole(role);
  };

  const handleDone = async () => {
    const accessChanged = stagedGeneralAccess !== initialGeneralAccess;
    const roleChanged =
      stagedGeneralAccess === 'anyone' && stagedGeneralRole !== initialGeneralRole;

    if (!accessChanged && !roleChanged) {
      onClose();
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      if (stagedGeneralAccess === 'anyone') {
        if (initialGeneralAccess === 'restricted' || !anyonePerm) {
          await addPermission(item.id, stagedGeneralRole, 'anyone');
        } else if (roleChanged && anyonePerm) {
          await updatePermission(item.id, anyonePerm.id, stagedGeneralRole);
        }
      } else {
        // Switched to restricted
        if (anyonePerm) {
          await removePermission(item.id, anyonePerm.id);
        }
      }

      onPermissionChanged?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to save general access:', err);
      setError(err?.message || 'Failed to update general access settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 dark:bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 text-sm transition-all"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2
            id="share-modal-title"
            className="text-lg sm:text-xl font-medium tracking-tight text-slate-900 dark:text-white truncate pr-2"
          >
            Share &ldquo;{item.name}&rdquo;
          </h2>
          <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <button
              type="button"
              title="Help"
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              onClick={() => alert('Folder sharing gives access to all files inside this folder automatically.')}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="px-6 pt-2 pb-6 overflow-y-auto max-h-[70vh] space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-2 text-rose-500 hover:text-rose-700"
              >
                ✕
              </button>
            </div>
          )}

          {/* Add People Input */}
          <form onSubmit={handleAddPerson} className="relative">
            <div
              className={`rounded-xl border transition-all ${
                isInputFocused || emailInput
                  ? 'border-blue-500 ring-2 ring-blue-500/20 dark:ring-blue-500/30'
                  : 'border-slate-300 dark:border-slate-700'
              } bg-white dark:bg-slate-800/80 p-2 sm:p-2.5 flex flex-col gap-2`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onFocus={() => setIsInputFocused(true)}
                  placeholder="Add people, groups, spaces, and calendar events"
                  className="w-full bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden"
                />
              </div>

              {(isInputFocused || emailInput) && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60 animate-in fade-in duration-150">
                  <div className="relative" data-share-dropdown>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDropdownId(
                          openDropdownId === 'add-role' ? null : 'add-role'
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 px-2 py-1 rounded-md"
                    >
                      <span>{getRoleLabel(newPersonRole)}</span>
                      <svg className="w-3 h-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>

                    {openDropdownId === 'add-role' && (
                      <div className="absolute left-0 mt-1 w-36 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 z-30">
                        <div className="px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                          ROLE
                        </div>
                        {(['reader', 'commenter', 'writer'] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => {
                              setNewPersonRole(r);
                              setOpenDropdownId(null);
                            }}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                          >
                            <span>{getRoleLabel(r)}</span>
                            {newPersonRole === r && (
                              <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEmailInput('');
                        setIsInputFocused(false);
                      }}
                      className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isAddingPerson || !emailInput.trim()}
                      onClick={() => handleAddPerson()}
                      className="px-3.5 py-1 text-xs font-semibold rounded-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      {isAddingPerson ? 'Adding...' : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>

          {/* People with access Section */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              People with access
            </h3>

            {isLoading && permissions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">
                Loading access list...
              </div>
            ) : (
              <div className="space-y-1">
                {/* Synthesize Owner if not explicitly returned in permissions */}
                {!hasExplicitOwner && (
                  <div className="flex items-center justify-between py-2 px-1 rounded-xl">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-bold text-xs flex items-center justify-center shrink-0 border border-teal-200 dark:border-teal-800">
                        {user?.name ? user.name.slice(0, 2).toUpperCase() : 'ME'}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">
                          {user?.name || 'Owner'} <span className="text-slate-500 dark:text-slate-400 font-normal">(you)</span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {user?.email || 'owner@drive.google.com'}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0 pr-1">
                      Owner
                    </span>
                  </div>
                )}

                {/* People from permissions */}
                {peopleWithAccess.map((perm) => {
                  const isCurrentUser =
                    Boolean(user?.email && perm.emailAddress?.toLowerCase() === user.email.toLowerCase()) ||
                    perm.role === 'owner';
                  const isOwner = perm.role === 'owner';
                  const initials = perm.displayName
                    ? perm.displayName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()
                    : (perm.emailAddress || 'U').slice(0, 2).toUpperCase();

                  return (
                    <div
                      key={perm.id}
                      className="flex items-center justify-between py-2 px-1 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {perm.photoLink ? (
                          <img
                            src={perm.photoLink}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-slate-200 truncate leading-tight">
                            {perm.displayName || perm.emailAddress || 'Collaborator'}{' '}
                            {isCurrentUser && (
                              <span className="text-slate-500 dark:text-slate-400 font-normal">
                                (you)
                              </span>
                            )}
                          </p>
                          {perm.emailAddress && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {perm.emailAddress}
                            </p>
                          )}
                        </div>
                      </div>

                      {isOwner ? (
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0 pr-1">
                          Owner
                        </span>
                      ) : (
                        <div className="relative shrink-0" data-share-dropdown>
                          <button
                            type="button"
                            aria-label={`Role for ${perm.displayName || perm.emailAddress || 'collaborator'}`}
                            onClick={() =>
                              setOpenDropdownId(
                                openDropdownId === perm.id ? null : perm.id
                              )
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 px-2 py-1 rounded-lg transition-colors"
                          >
                            <span>{getRoleLabel(perm.role)}</span>
                            <svg className="w-3 h-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>

                          {openDropdownId === perm.id && (
                            <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 z-30">
                              <div className="px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                                ROLE
                              </div>
                              {(['reader', 'commenter', 'writer'] as const).map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => handleUpdateRole(perm.id, r)}
                                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                                >
                                  <span>{getRoleLabel(r)}</span>
                                  {perm.role === r && (
                                    <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              ))}
                              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                              <button
                                type="button"
                                onClick={() => handleRemovePermission(perm.id)}
                                className="w-full px-3 py-1.5 text-xs text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              >
                                Remove access
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* General Access Section */}
          <div className="pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              General access
            </h3>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-start gap-3 min-w-0">
                {/* Icon Circle */}
                {stagedGeneralAccess === 'anyone' ? (
                  <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                )}

                <div className="min-w-0">
                  {/* Access Dropdown Trigger */}
                  <div className="relative" data-share-dropdown>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDropdownId(
                          openDropdownId === 'general-access' ? null : 'general-access'
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 px-1.5 py-0.5 -ml-1.5 rounded-md transition-colors"
                    >
                      <span>
                        {stagedGeneralAccess === 'anyone'
                          ? 'Anyone with the link'
                          : 'Restricted'}
                      </span>
                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${openDropdownId === 'general-access' ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>

                    {openDropdownId === 'general-access' && (
                      <div className="absolute left-0 bottom-full mb-1.5 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                        <button
                          type="button"
                          onClick={() => handleToggleGeneralAccess('restricted')}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                        >
                          <span>Restricted</span>
                          {stagedGeneralAccess === 'restricted' && (
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleGeneralAccess('anyone')}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                        >
                          <span>Anyone with the link</span>
                          {stagedGeneralAccess === 'anyone' && (
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                    {stagedGeneralAccess === 'anyone'
                      ? stagedGeneralRole === 'writer'
                        ? 'Anyone on the internet with the link can edit'
                        : stagedGeneralRole === 'commenter'
                        ? 'Anyone on the internet with the link can comment'
                        : 'Anyone on the internet with the link can view'
                      : 'Only people with access can open with the link'}
                  </p>
                </div>
              </div>

              {/* Public Role Picker (only when Anyone with the link is active) */}
              {stagedGeneralAccess === 'anyone' && (
                <div className="relative shrink-0 ml-2" data-share-dropdown>
                  <button
                    type="button"
                    aria-label="General access role"
                    onClick={() =>
                      setOpenDropdownId(
                        openDropdownId === 'general-role' ? null : 'general-role'
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 px-2 py-1 rounded-lg transition-colors"
                  >
                    <span>{getRoleLabel(stagedGeneralRole)}</span>
                    <svg className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${openDropdownId === 'general-role' ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>

                  {openDropdownId === 'general-role' && (
                    <div className="absolute right-0 bottom-full mb-1.5 w-52 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                        ROLE
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGeneralRoleChange('reader')}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                      >
                        <span>Viewer</span>
                        {stagedGeneralRole === 'reader' && (
                          <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGeneralRoleChange('commenter')}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                      >
                        <span>Commenter</span>
                        {stagedGeneralRole === 'commenter' && (
                          <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGeneralRoleChange('writer')}
                        className="w-full flex items-start justify-between px-3 py-2 text-xs text-left hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                      >
                        <div>
                          <p className="font-medium">Editor</p>
                          <p className="text-[10px] text-slate-400">
                            Organize, add, and edit files
                          </p>
                        </div>
                        {stagedGeneralRole === 'writer' && (
                          <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 mt-2">
          {/* Copy link pill button */}
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/70 text-blue-600 dark:text-blue-400 text-xs font-semibold shadow-2xs transition-colors"
          >
            {copiedLink ? (
              <>
                <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-600 dark:text-emerald-400">Link copied</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Copy link</span>
              </>
            )}
          </button>

          {/* Done pill button */}
          <button
            type="button"
            disabled={isSaving}
            onClick={handleDone}
            className="px-6 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {isSaving && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            <span>{isSaving ? 'Saving...' : 'Done'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
