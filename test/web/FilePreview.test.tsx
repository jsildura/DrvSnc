import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import * as XLSX from 'xlsx';
import FilePreview from '../../src/components/FilePreview';

// docx-preview parses real OOXML and touches canvas APIs jsdom does not implement,
// so the renderer is mocked and the assertion is that the component hands it the
// document bytes and the on-page container.
const docxMock = vi.hoisted(() => ({
  renderAsync: vi.fn<(buffer: ArrayBuffer, container: HTMLElement) => Promise<void>>(),
}));

vi.mock('docx-preview', () => ({ renderAsync: docxMock.renderAsync }));

const PDF_BYTES = '%PDF-1.4 mock pdf content';

const pdfResponse = () =>
  new Response(new Blob([PDF_BYTES], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });

/** Build a real two-sheet workbook so the SheetJS path is exercised for real. */
function buildWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Region', 'Q1', 'Q2'],
      ['North', 120, 140],
      ['South', 90, 115],
    ]),
    'Summary'
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Note'], ['Draft only']]), 'Notes');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const pdfObjectData = () =>
  document.querySelector('object[type="application/pdf"]')?.getAttribute('data') ?? null;

describe('Native Google Drive File Preview Component (<FilePreview />)', () => {
  let createdBlobs: Blob[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    docxMock.renderAsync.mockReset();

    // jsdom implements neither of these, and the document viewer is built entirely
    // around them — without stubs the PDF path fails silently into its error card.
    createdBlobs = [];
    let counter = 0;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      counter += 1;
      return `blob:mock/${counter}`;
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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
    expect(screen.getByLabelText('Zoom in (+)')).toBeDefined();
    expect(screen.getByLabelText('Zoom out (-)')).toBeDefined();
    expect(screen.getByLabelText('Rotate 90°')).toBeDefined();
    expect(screen.getByLabelText('Reset (0)')).toBeDefined();

    // Zoom In
    const zoomInBtn = screen.getByLabelText('Zoom in (+)');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('125%')).toBeDefined();

    // Rotate
    const rotateBtn = screen.getByLabelText('Rotate 90°');
    fireEvent.click(rotateBtn);
  });

  it('renders video player with custom controls', async () => {
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

    const copyBtn = screen.getByLabelText('Copy text');
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
      expect(screen.getAllByText('5.00 MB').length).toBeGreaterThan(0);
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

  // ---------------------------------------------------------------------------
  // Google Workspace files: exported to PDF server-side, rendered from a blob
  // ---------------------------------------------------------------------------

  const workspaceCases = [
    {
      kind: 'Google Docs',
      fileId: 'gdoc-123',
      fileName: 'Project Proposal',
      mimeType: 'application/vnd.google-apps.document',
    },
    {
      kind: 'Google Sheets',
      fileId: 'gsheet-123',
      fileName: 'Financial Model',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    {
      kind: 'Google Slides',
      fileId: 'gslide-123',
      fileName: 'Pitch Deck',
      mimeType: 'application/vnd.google-apps.presentation',
    },
  ];

  workspaceCases.forEach(({ kind, fileId, fileName, mimeType }) => {
    it(`exports a ${kind} file as PDF through the API and renders it from a blob URL`, async () => {
      const fetchMock = vi.fn(async () => pdfResponse());
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      render(
        <FilePreview open={true} onClose={vi.fn()} fileId={fileId} fileName={fileName} mimeType={mimeType} />
      );

      // Workspace files have no binary content, so the viewer must ask the worker for
      // a PDF export rather than a plain download.
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/v1/drive/files/${fileId}/download?exportMimeType=application/pdf`
        );
      });

      await waitFor(() => {
        expect(pdfObjectData()).toBe('blob:mock/1#zoom=100');
      });

      expect(createdBlobs).toHaveLength(1);
      expect(createdBlobs[0].type).toBe('application/pdf');
      expect(screen.getByText(fileName)).toBeDefined();
      expect(screen.getByText(kind)).toBeDefined();

      // The bytes must arrive over the session-authenticated API. A docs.google.com
      // iframe would render nothing for a file that isn't publicly shared.
      expect(document.querySelector('iframe[src*="google.com"]')).toBeNull();
    });
  });

  it('renders a direct PDF from the authenticated download endpoint', async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="pdf-1"
        fileName="quarterly_report.pdf"
        mimeType="application/pdf"
        fileUrl="/api/v1/drive/files/pdf-1/download"
      />
    );

    // No exportMimeType: a real PDF already has bytes to stream.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/drive/files/pdf-1/download');
    });
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=100'));
    expect(document.querySelector('iframe[src*="google.com"]')).toBeNull();
  });

  it('surfaces an export failure with an escape hatch instead of a blank frame', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="gdoc-broken"
        fileName="Broken Doc"
        mimeType="application/vnd.google-apps.document"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Unable to generate in-app PDF preview/)).toBeDefined();
      expect(screen.getByText('Open in Google Docs')).toBeDefined();
    });
    expect(pdfObjectData()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Document zoom
  // ---------------------------------------------------------------------------

  it('drives PDF zoom and fit-width through the viewer URL fragment', async () => {
    globalThis.fetch = vi.fn(async () => pdfResponse()) as unknown as typeof fetch;

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="gdoc-zoom"
        fileName="Zoomable Doc"
        mimeType="application/vnd.google-apps.document"
      />
    );

    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=100'));

    // There is no DOM API for zooming an embedded PDF, so the fragment is the only
    // thing that can make these buttons do anything at all.
    fireEvent.click(screen.getByLabelText('Zoom in (+)'));
    expect(screen.getByText('125%')).toBeDefined();
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=125'));

    fireEvent.click(screen.getByLabelText('Zoom out (-)'));
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=100'));

    fireEvent.click(screen.getByLabelText('Fit width'));
    expect(screen.getByText('Fit')).toBeDefined();
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#view=FitH'));

    fireEvent.click(screen.getByLabelText('Reset (0)'));
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=100'));

    // The +/-/0 shortcuts used to move the image zoom, which no document viewer reads.
    fireEvent.keyDown(window, { key: '+' });
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=125'));
    fireEvent.keyDown(window, { key: '0' });
    await waitFor(() => expect(pdfObjectData()).toBe('blob:mock/1#zoom=100'));
  });

  it('prints through an offscreen iframe rather than a popup window', async () => {
    globalThis.fetch = vi.fn(async () => pdfResponse()) as unknown as typeof fetch;
    const openSpy = vi.fn();
    const printSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    vi.stubGlobal('print', printSpy);

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="gdoc-print"
        fileName="Printable Doc"
        mimeType="application/vnd.google-apps.document"
      />
    );

    await waitFor(() => expect(pdfObjectData()).not.toBeNull());

    fireEvent.click(screen.getByLabelText('Print Document'));

    const frame = document.getElementById('gdu-preview-print-frame') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('blob:mock/1');
    // display:none frames are unprintable in several browsers, so it must have layout.
    expect(frame?.style.display).not.toBe('none');
    expect(frame?.style.position).toBe('fixed');

    // window.open + print() printed a blank page and died behind popup blockers;
    // window.print() would print the modal chrome instead of the document.
    expect(openSpy).not.toHaveBeenCalled();
    expect(printSpy).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Office formats rendered client-side
  // ---------------------------------------------------------------------------

  it('renders a .docx with docx-preview into the on-page container', async () => {
    docxMock.renderAsync.mockImplementation(async (_buffer, container) => {
      container.innerHTML = '<section class="docx"><p>Mock contract body</p></section>';
    });
    const fetchMock = vi.fn(async () => new Response(new ArrayBuffer(128), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="docx-123"
        fileName="contract.docx"
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fileUrl="/api/v1/drive/files/docx-123/download"
      />
    );

    await waitFor(() => {
      expect(docxMock.renderAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Mock contract body')).toBeDefined();
    });

    const [buffer, container] = docxMock.renderAsync.mock.calls[0];
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(container).toBeInstanceOf(HTMLElement);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/drive/files/docx-123/download');
    expect(screen.getByText('contract.docx')).toBeDefined();
    expect(screen.getByText('Google Docs')).toBeDefined();
  });

  it('sends a legacy .doc to the office fallback instead of the docx renderer', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="doc-legacy"
        fileName="1998_memo.doc"
        mimeType="application/msword"
        fileUrl="/api/v1/drive/files/doc-legacy/download"
      />
    );

    // .doc is an OLE2 compound file; docx-preview cannot parse it, so attempting to
    // render it only ever produced an error card.
    expect(docxMock.renderAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/Google Docs can open it/)).toBeDefined();
    expect(screen.getByText('Open in Google Docs')).toBeDefined();
    expect(screen.getByText('Download')).toBeDefined();
  });

  it('parses a spreadsheet, tabs between sheets, and keeps true row numbers when filtering', async () => {
    const buffer = buildWorkbook();
    globalThis.fetch = vi.fn(async () => new Response(buffer, { status: 200 })) as unknown as typeof fetch;

    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="xlsx-1"
        fileName="sales.xlsx"
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileUrl="/api/v1/drive/files/xlsx-1/download"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Region')).toBeDefined();
      expect(screen.getByText('North')).toBeDefined();
      expect(screen.getByText('South')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Notes'));
    await waitFor(() => expect(screen.getByText('Draft only')).toBeDefined());

    fireEvent.click(screen.getByText('Summary'));
    await waitFor(() => expect(screen.getByText('South')).toBeDefined());

    fireEvent.change(screen.getByPlaceholderText('Search spreadsheet cells...'), {
      target: { value: 'south' },
    });

    await waitFor(() => expect(screen.queryByText('North')).toBeNull());

    // The label row stays pinned — filtering it away left nothing but column letters —
    // and the match keeps its real spreadsheet row number (3), not its position (2).
    expect(screen.getByText('Region')).toBeDefined();
    const rowNumbers = Array.from(document.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelector('td')?.textContent
    );
    expect(rowNumbers).toEqual(['1', '3']);
  });

  // ---------------------------------------------------------------------------
  // PowerPoint
  // ---------------------------------------------------------------------------

  it('previews a PowerPoint from the Drive file endpoint and can fall back to thumbnails', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="pptx-1"
        fileName="deck.pptx"
        mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
        thumbnailLink="https://lh3.googleusercontent.com/abc=s220"
        fileUrl="/api/v1/drive/files/pptx-1/download"
      />
    );

    // /presentation/d/ only serves native Google Slides — for an uploaded .pptx it
    // renders an error page. Binary files live under /file/d/.
    expect(document.querySelector('iframe[title="deck.pptx"]')?.getAttribute('src')).toBe(
      'https://drive.google.com/file/d/pptx-1/preview'
    );

    fireEvent.click(screen.getByText('Slides not showing? Show slide thumbnails'));

    await waitFor(() => {
      expect(screen.getByAltText('First slide of deck.pptx').getAttribute('src')).toBe(
        'https://lh3.googleusercontent.com/abc=s1600'
      );
    });
    expect(document.querySelector('iframe[title="deck.pptx"]')).toBeNull();
    expect(screen.getByText('Open in Google Slides')).toBeDefined();
  });

  it('falls back to thumbnails on its own when the Drive frame never loads', async () => {
    vi.useFakeTimers();
    try {
      render(
        <FilePreview
          open={true}
          onClose={vi.fn()}
          fileId="pptx-slow"
          fileName="slow_deck.pptx"
          mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
          thumbnailLink="https://lh3.googleusercontent.com/slow=s220"
        />
      );

      expect(document.querySelector('iframe[title="slow_deck.pptx"]')).not.toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(8000);
      });

      expect(screen.getByAltText('First slide of slow_deck.pptx')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains itself when a presentation has no thumbnail to fall back to', async () => {
    render(
      <FilePreview
        open={true}
        onClose={vi.fn()}
        fileId="pptx-bare"
        fileName="bare_deck.pptx"
        mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation"
      />
    );

    fireEvent.click(screen.getByText('Slides not showing? Show slide thumbnails'));

    await waitFor(() => {
      expect(screen.getByText('Unable to preview this presentation')).toBeDefined();
    });
    expect(screen.getByText('Open in Google Slides')).toBeDefined();
    expect(screen.getByText('Download')).toBeDefined();
  });
});
