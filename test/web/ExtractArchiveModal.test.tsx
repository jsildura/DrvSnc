import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ExtractArchiveModal } from '../../src/web/components/ExtractArchiveModal';
import { DriveItemView } from '../../src/shared/contracts';

describe('ExtractArchiveModal Component', () => {
  const mockArchive: DriveItemView = {
    id: 'archive-file-123',
    name: 'project-backup.zip',
    mimeType: 'application/zip',
    isFolder: false,
    size: 1048576,
    shared: false,
    trashed: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders extraction modal with archive details and progress screen', () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/extract-init')) {
        return new Response(
          JSON.stringify({
            fileId: 'archive-file-123',
            fileName: 'project-backup.zip',
            fileSize: 1048576,
            accessToken: 'mock-token',
            extractMeHost: 's84.extract.me',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    render(
      <ExtractArchiveModal
        isOpen={true}
        item={mockArchive}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText('Extract Archive')).toBeDefined();
    expect(screen.getByText('project-backup.zip')).toBeDefined();

    // Verify user privacy notice is NOT present (per explicit requirement: "thats okay, dont add a brief notice")
    expect(screen.queryByText(/third-party/i)).toBeNull();
    expect(screen.queryByText(/extract\.me/i)).toBeNull();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ExtractArchiveModal
        isOpen={false}
        item={mockArchive}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
