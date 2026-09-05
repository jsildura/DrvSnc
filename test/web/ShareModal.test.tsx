import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ShareModal from '../../src/web/components/ShareModal';
import { DriveItemView } from '../../src/shared/contracts';

describe('Google Drive Share Modal (<ShareModal />)', () => {
  const mockFolder: DriveItemView = {
    id: 'folder-cert-123',
    name: 'Certificate',
    mimeType: 'application/vnd.google-apps.folder',
    isFolder: true,
    shared: false,
    trashed: false,
    webViewLink: 'https://drive.google.com/drive/folders/folder-cert-123',
  };

  const initialPermissions = [
    {
      id: 'perm-owner',
      role: 'owner',
      type: 'user',
      emailAddress: 'sildura.joelito.t@gmail.com',
      displayName: 'Joelito Sildura',
    },
    {
      id: 'perm-collab-1',
      role: 'reader',
      type: 'user',
      emailAddress: 'collab@example.com',
      displayName: 'Collaborator Jane',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders modal with item name, people list, and restricted general access', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/permissions')) {
        return new Response(JSON.stringify({ permissions: initialPermissions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    render(
      <ShareModal
        isOpen={true}
        onClose={vi.fn()}
        item={mockFolder}
      />
    );

    expect(screen.getByText(/Share “Certificate”/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Add people, groups, spaces, and calendar events/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('Joelito Sildura')).toBeDefined();
      expect(screen.getByText('Collaborator Jane')).toBeDefined();
      expect(screen.getByText('collab@example.com')).toBeDefined();
    });

    // Verify general access default is Restricted
    expect(screen.getByText('Restricted')).toBeDefined();
    expect(screen.getByText('Only people with access can open with the link')).toBeDefined();
  });

  it('adds a new person with role', async () => {
    let addedPayload: any = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/permissions') && init?.method === 'POST') {
        addedPayload = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            id: 'perm-new-1',
            role: addedPayload.role,
            type: 'user',
            emailAddress: addedPayload.emailAddress,
            displayName: 'New User',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/permissions')) {
        return new Response(JSON.stringify({ permissions: initialPermissions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    const onPermissionChanged = vi.fn();

    render(
      <ShareModal
        isOpen={true}
        onClose={vi.fn()}
        item={mockFolder}
        onPermissionChanged={onPermissionChanged}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Collaborator Jane')).toBeDefined();
    });

    const input = screen.getByPlaceholderText(/Add people, groups, spaces/i);
    fireEvent.change(input, { target: { value: 'alice@example.com' } });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(addedPayload).toEqual({
        role: 'reader',
        type: 'user',
        emailAddress: 'alice@example.com',
      });
      expect(screen.getByText('alice@example.com')).toBeDefined();
      expect(onPermissionChanged).toHaveBeenCalled();
    });
  });

  it('toggles general access to Anyone with the link and updates role only upon clicking Done', async () => {
    let createdPublicPerm = false;
    let postRole: string | null = null;
    const onClose = vi.fn();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/permissions') && init?.method === 'POST') {
        createdPublicPerm = true;
        const body = JSON.parse(init.body as string);
        postRole = body.role;
        return new Response(
          JSON.stringify({
            id: 'perm-anyone-1',
            role: body.role,
            type: 'anyone',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/permissions')) {
        return new Response(JSON.stringify({ permissions: initialPermissions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <ShareModal
        isOpen={true}
        onClose={onClose}
        item={mockFolder}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Restricted')).toBeDefined();
    });

    // Click General Access dropdown trigger
    const generalTrigger = screen.getByRole('button', { name: /Restricted/i });
    fireEvent.click(generalTrigger);

    // Select "Anyone with the link"
    const anyoneOption = screen.getByRole('button', { name: /Anyone with the link/i });
    fireEvent.click(anyoneOption);

    // Staged: UI updates description, but no API mutation has occurred yet
    expect(createdPublicPerm).toBe(false);
    expect(screen.getByText('Anyone on the internet with the link can view')).toBeDefined();

    // Now change general role to Editor
    const roleTrigger = screen.getByRole('button', { name: 'General access role' });
    fireEvent.click(roleTrigger);

    const editorOption = screen.getByRole('button', { name: /Editor/i });
    fireEvent.click(editorOption);

    // Staged: UI updates description, still no API call
    expect(createdPublicPerm).toBe(false);
    expect(screen.getByText('Anyone on the internet with the link can edit')).toBeDefined();

    // Now click Done button to confirm and save changes
    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);

    await waitFor(() => {
      expect(createdPublicPerm).toBe(true);
      expect(postRole).toBe('writer');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('discards general access changes if modal is closed without clicking Done', async () => {
    let createdPublicPerm = false;
    const onClose = vi.fn();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/permissions') && init?.method === 'POST') {
        createdPublicPerm = true;
        return new Response(JSON.stringify({ id: 'perm-anyone-1' }), { status: 200 });
      }

      if (url.includes('/permissions')) {
        return new Response(JSON.stringify({ permissions: initialPermissions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <ShareModal
        isOpen={true}
        onClose={onClose}
        item={mockFolder}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Restricted')).toBeDefined();
    });

    // Select "Anyone with the link"
    const generalTrigger = screen.getByRole('button', { name: /Restricted/i });
    fireEvent.click(generalTrigger);
    const anyoneOption = screen.getByRole('button', { name: /Anyone with the link/i });
    fireEvent.click(anyoneOption);

    // Close the modal via the Close button without clicking Done
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
    // Verify no mutation was sent
    expect(createdPublicPerm).toBe(false);
  });

  it('copies link to clipboard and calls onClose on Done button click', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ permissions: initialPermissions }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const onCloseMock = vi.fn();

    render(
      <ShareModal
        isOpen={true}
        onClose={onCloseMock}
        item={mockFolder}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy link/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('https://drive.google.com/drive/folders/folder-cert-123');
      expect(screen.getByText('Link copied')).toBeDefined();
    });

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(onCloseMock).toHaveBeenCalled();
  });

  it('updates collaborator role and allows removing access', async () => {
    let updatedRole: string | null = null;
    let removedId: string | null = null;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/perm-collab-1') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string);
        updatedRole = body.role;
        return new Response(
          JSON.stringify({
            id: 'perm-collab-1',
            role: body.role,
            type: 'user',
            emailAddress: 'collab@example.com',
            displayName: 'Collaborator Jane',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/perm-collab-1') && init?.method === 'DELETE') {
        removedId = 'perm-collab-1';
        return new Response(null, { status: 204 });
      }

      if (url.includes('/permissions')) {
        return new Response(JSON.stringify({ permissions: initialPermissions }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    });

    render(
      <ShareModal
        isOpen={true}
        onClose={vi.fn()}
        item={mockFolder}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Collaborator Jane')).toBeDefined();
    });

    // Click Collaborator Jane's role dropdown
    const collabRoleBtn = screen.getByRole('button', { name: 'Role for Collaborator Jane' });
    fireEvent.click(collabRoleBtn);

    // Change to Editor
    const editorOpt = screen.getByRole('button', { name: /Editor/i });
    fireEvent.click(editorOpt);

    await waitFor(() => {
      expect(updatedRole).toBe('writer');
    });

    // Open dropdown again and click Remove access
    const updatedCollabBtn = screen.getByRole('button', { name: 'Role for Collaborator Jane' });
    fireEvent.click(updatedCollabBtn);
    const removeBtn = await screen.findByRole('button', { name: /Remove access/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(removedId).toBe('perm-collab-1');
      expect(screen.queryByText('collab@example.com')).toBeNull();
    });
  });
});

