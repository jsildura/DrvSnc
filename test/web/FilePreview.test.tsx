import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import FilePreview from '../../src/components/FilePreview';

describe('Native Google Drive File Preview Component (<FilePreview />)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders native image preview with zoom and rotate controls', async () => {
    const onClose = vi.fn();
    render(
      <FilePreview
        open={true}
        onClose={onClose}
        fileId="img-123"
        fileName="vacation_photo.jpg"
        mimeType="image/jpeg"
        fileSize={2048000}
        fileUrl="https://example.com/vacation_photo.jpg"
      />
    );

    expect(screen.getByText('vacation_photo.jpg')).toBeDefined();
    expect(screen.getByLabelText('Zoom In (+)')).toBeDefined();
    expect(screen.getByLabelText('Zoom Out (-)')).toBeDefined();
    expect(screen.getByLabelText('Rotate 90°')).toBeDefined();
    expect(screen.getByLabelText('Reset Zoom (0)')).toBeDefined();

    // Zoom In
    const zoomInBtn = screen.getByLabelText('Zoom In (+)');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('125%')).toBeDefined();

    // Rotate
    const rotateBtn = screen.getByLabelText('Rotate 90°');
    fireEvent.click(rotateBtn);
  });

  it('renders video player with custom controls and playback rate options', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="vid-123"
        fileName="demo_recording.mp4"
        mimeType="video/mp4"
        fileSize={15000000}
        fileUrl="https://example.com/demo_recording.mp4"
      />
    );

    expect(screen.getByText('demo_recording.mp4')).toBeDefined();
    expect(screen.getByLabelText('Play video')).toBeDefined();
    expect(screen.getByText('1x')).toBeDefined();
    expect(screen.getByText('1.5x')).toBeDefined();
  });

  it('renders audio player with custom controls and audio file icon', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="audio-123"
        fileName="podcast_episode.mp3"
        mimeType="audio/mp3"
        fileSize={8000000}
        fileUrl="https://example.com/podcast_episode.mp3"
      />
    );

    expect(screen.getAllByText('podcast_episode.mp3').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Play audio')).toBeDefined();
  });


  it('renders text/code files with line numbers and copy button', async () => {
    const mockCode = 'function helloWorld() {\n  console.log("Hello from Google Drive!");\n  return 42;\n}';
    globalThis.fetch = vi.fn(async () => {
      return new Response(mockCode, {
        status: 200,
        headers: { 'Content-Type': 'text/javascript' },
      });
    });

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="code-123"
        fileName="index.ts"
        mimeType="text/typescript"
        fileSize={1024}
        fileUrl="/api/v1/drive/files/code-123/download"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeDefined();
      expect(screen.getByText(/function helloWorld/)).toBeDefined();
      expect(screen.getByText('1')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
    });

    const copyBtn = screen.getByLabelText('Copy Code');
    expect(copyBtn).toBeDefined();
  });

  it('renders CSV files as an interactive data table with search filter', async () => {
    const mockCsv = 'Name,Role,City\nAlice,Engineer,San Francisco\nBob,Designer,New York\nCharlie,Manager,London';
    globalThis.fetch = vi.fn(async () => {
      return new Response(mockCsv, {
        status: 200,
        headers: { 'Content-Type': 'text/csv' },
      });
    });

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="csv-123"
        fileName="users.csv"
        mimeType="text/csv"
        fileSize={512}
        fileUrl="/api/v1/drive/files/csv-123/download"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('users.csv')).toBeDefined();
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Engineer')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
      expect(screen.getByText('Charlie')).toBeDefined();
    });
  });

  it('renders fallback for unsupported binary files with download button', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="archive-123"
        fileName="backup_database.tar.gz"
        mimeType="application/gzip"
        fileSize={104857600}
        fileUrl="/api/v1/drive/files/archive-123/download"
      />
    );

    expect(screen.getAllByText('backup_database.tar.gz').length).toBeGreaterThan(0);
    expect(screen.getByText(/No native preview available for this file type/)).toBeDefined();
    expect(screen.getByText('Download')).toBeDefined();
  });

  it('allows cycling between files with previous and next navigation buttons', async () => {
    const mockFiles = [
      { id: 'f-1', name: 'photo1.jpg', mimeType: 'image/jpeg', size: 1000 },
      { id: 'f-2', name: 'photo2.jpg', mimeType: 'image/jpeg', size: 2000 },
      { id: 'f-3', name: 'document.pdf', mimeType: 'application/pdf', size: 3000 },
    ];

    const onNavigate = vi.fn();

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        files={mockFiles}
        currentIndex={0}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByText('photo1.jpg')).toBeDefined();
    expect(screen.getByText('1 of 3')).toBeDefined();

    const nextBtn = screen.getByLabelText('Next file');
    fireEvent.click(nextBtn);

    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('opens and closes the file info details drawer', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="f-999"
        fileName="quarterly_report.pdf"
        mimeType="application/pdf"
        fileSize={5242880}
        modifiedTime="2026-08-15T10:00:00Z"
        createdTime="2026-08-10T08:00:00Z"
        owners={[{ displayName: 'Jane Doe', emailAddress: 'jane@example.com' }]}
      />
    );

    const infoBtn = screen.getByLabelText('File details (i)');
    fireEvent.click(infoBtn);

    await waitFor(() => {
      expect(screen.getByText('File Details')).toBeDefined();
      expect(screen.getByText('5.00 MB')).toBeDefined();
      expect(screen.getByText('Jane Doe')).toBeDefined();
    });
  });

  it('closes preview on Escape key press', async () => {
    const onClose = vi.fn();
    render(
      <FilePreview
        open={true}
        onClose={onClose}
        fileId="doc-1"
        fileName="notes.txt"
        mimeType="text/plain"
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
