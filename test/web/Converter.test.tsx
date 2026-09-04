import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ConverterPage } from '../../src/web/routes/ConverterPage';
import {
  startEncodingJob,
  uploadDriveVideoToEncoder,
} from '../../src/web/converter/converterClient';
import * as driveApi from '../../src/web/api/drive';

describe('ConverterPage & ConverterPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Step 1 and Step 2 with default Video/MP4 options and disabled Convert button', () => {
    render(<ConverterPage />);

    expect(screen.getByText('Media & Document Converter')).toBeDefined();
    expect(screen.getByText('Google Drive')).toBeDefined();

    // Tabs
    expect(screen.getByRole('button', { name: 'Video' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeDefined();

    // Video Formats
    expect(screen.getByRole('button', { name: 'mp4' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'avi' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mpeg' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mov' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'flv' })).toBeDefined();
    expect(screen.getByRole('button', { name: '3gp' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'webm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mkv' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'wmv' })).toBeDefined();

    // Resolution & Settings
    expect(screen.getByText('Resolution:')).toBeDefined();
    expect(screen.getByText('Same as source')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();

    // Convert button is disabled when no file is chosen
    const convertBtn = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convertBtn.disabled).toBe(true);
  });

  it('selects 3gp format, defaults to 176x144, and shows 3gp specific mobile resolutions', () => {
    render(<ConverterPage />);

    // Click 3gp button
    const threeGpBtn = screen.getByRole('button', { name: '3gp' });
    fireEvent.click(threeGpBtn);

    // Default resolution for 3gp is 176x144
    expect(screen.getAllByText('176x144').length).toBeGreaterThanOrEqual(1);

    // Open resolution dropdown
    const trigger = screen.getAllByText('176x144')[0];
    fireEvent.click(trigger);

    // Verify 3gp specific resolutions appear
    expect(screen.getByText('HD 720p')).toBeDefined();
    expect(screen.getByText('1280x720')).toBeDefined();
    expect(screen.getByText('480p')).toBeDefined();
    expect(screen.getByText('854x480')).toBeDefined();
    expect(screen.getByText('TV')).toBeDefined();
    expect(screen.getByText('640x480')).toBeDefined();
    expect(screen.getAllByText('320x240').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('128x96').length).toBeGreaterThanOrEqual(1);
  });

  it('switches to Audio mode and displays audio formats and quality presets', () => {
    render(<ConverterPage />);

    const audioTab = screen.getByRole('button', { name: 'Audio' });
    fireEvent.click(audioTab);

    // Audio Formats (including iPhone)
    expect(screen.getByRole('button', { name: 'mp3' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'wav' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'iPhone' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'm4a' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'flac' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'ogg' })).toBeDefined();

    // Audio Quality Slider
    expect(screen.getByText('Quality')).toBeDefined();
    expect(screen.getByText('Standard')).toBeDefined();
    expect(screen.getByText('128 kbps')).toBeDefined();
    expect(screen.getByText('Good')).toBeDefined();
    expect(screen.getByText('192 kbps')).toBeDefined();
    expect(screen.getByText('Best')).toBeDefined();
    expect(screen.getByText('320 kbps')).toBeDefined();
    expect(screen.getByText('Economy')).toBeDefined();
    expect(screen.getByText('64 kbps')).toBeDefined();

    // Right-side Action Buttons
    expect(screen.getByRole('button', { name: 'Advanced settings' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit track info' })).toBeDefined();

    // Switch back to Video mode
    const videoTab = screen.getByRole('button', { name: 'Video' });
    fireEvent.click(videoTab);

    expect(screen.getByRole('button', { name: 'mp4' })).toBeDefined();
    expect(screen.getByText('Resolution:')).toBeDefined();
  });

  it('toggles audio Advanced settings and ID3 track info drawers mutually', () => {
    render(<ConverterPage />);

    const audioTab = screen.getByRole('button', { name: 'Audio' });
    fireEvent.click(audioTab);

    // 1. Open Advanced settings
    const advBtn = screen.getByRole('button', { name: 'Advanced settings' });
    fireEvent.click(advBtn);

    expect(screen.getByText('Bitrate')).toBeDefined();
    expect(screen.getByText('Constant')).toBeDefined();
    expect(screen.getByText('Sample rate')).toBeDefined();
    expect(screen.getByText('Channels')).toBeDefined();
    expect(screen.getByText('Fade in')).toBeDefined();
    expect(screen.getByText('Fade out')).toBeDefined();
    expect(screen.getByText('Reverse')).toBeDefined();

    // Toggle Fade in checkbox
    const fadeInCheckbox = screen.getByLabelText('Fade in') as HTMLInputElement;
    fireEvent.click(fadeInCheckbox);
    expect(fadeInCheckbox.checked).toBe(true);

    // 2. Open Edit track info (should mutually close Advanced settings)
    const trackBtn = screen.getByRole('button', { name: 'Edit track info' });
    fireEvent.click(trackBtn);

    expect(screen.queryByText('Sample rate')).toBeNull();
    expect(screen.getByText('Edit Audio Track Information (ID3 Tags)')).toBeDefined();
    expect(screen.getByPlaceholderText('Track Title')).toBeDefined();
    expect(screen.getByPlaceholderText('Artist / Performer')).toBeDefined();
    expect(screen.getByPlaceholderText('Album Name')).toBeDefined();

    // Enter title & artist
    const titleInput = screen.getByPlaceholderText('Track Title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'My Song' } });
    expect(titleInput.value).toBe('My Song');

    // Click "Clear tags"
    const clearBtn = screen.getByText('Clear tags');
    fireEvent.click(clearBtn);
    expect(titleInput.value).toBe('');

    // Toggle track info off
    fireEvent.click(trackBtn);
    expect(screen.queryByText('Edit Audio Track Information (ID3 Tags)')).toBeNull();
  });

  it('switches audio formats and updates quality slider stops for WAV and FLAC', () => {
    render(<ConverterPage />);

    const audioTab = screen.getByRole('button', { name: 'Audio' });
    fireEvent.click(audioTab);

    // Switch to WAV
    const wavBtn = screen.getByRole('button', { name: 'wav' });
    fireEvent.click(wavBtn);

    expect(screen.getByText('Tape quality')).toBeDefined();
    expect(screen.getByText('20 Khz')).toBeDefined();
    expect(screen.getByText('CD quality')).toBeDefined();
    expect(screen.getByText('44.1 Khz')).toBeDefined();

    // Switch to FLAC (Lossless)
    const flacBtn = screen.getByRole('button', { name: 'flac' });
    fireEvent.click(flacBtn);

    expect(screen.getByText(/Lossless Audio Quality/i)).toBeDefined();

    // Open more dropdown and select mp2
    const moreBtn = screen.getByRole('button', { name: /more/i });
    fireEvent.click(moreBtn);

    const mp2Btn = screen.getByRole('button', { name: 'mp2' });
    fireEvent.click(mp2Btn);

    // mp2 has standard presets
    expect(screen.getByText('Good')).toBeDefined();
    expect(screen.getByText('160 kbps')).toBeDefined();
  });

  it('opens the Resolution dropdown and allows selecting a custom resolution preset', async () => {
    render(<ConverterPage />);

    // Click the resolution dropdown trigger
    const resolutionBtn = screen.getByText('Same as source');
    fireEvent.click(resolutionBtn);

    // All presets from Image 2 should appear in dropdown
    expect(screen.getByText('HD 1080p')).toBeDefined();
    expect(screen.getByText('1920x1080')).toBeDefined();
    expect(screen.getByText('HD 720p')).toBeDefined();
    expect(screen.getByText('1280x720')).toBeDefined();
    expect(screen.getByText('480p')).toBeDefined();
    expect(screen.getByText('360p')).toBeDefined();
    expect(screen.getByText('240p')).toBeDefined();
    expect(screen.getByText('DVD')).toBeDefined();
    expect(screen.getByText('TV')).toBeDefined();
    expect(screen.getByText('Mobile')).toBeDefined();

    // Select HD 1080p
    fireEvent.click(screen.getByText('HD 1080p'));

    // Trigger button now displays HD 1080p
    expect(screen.getByText('HD 1080p')).toBeDefined();
  });

  it('toggles the Advanced Settings drawer', () => {
    render(<ConverterPage />);

    const settingsBtn = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(settingsBtn);

    expect(screen.getByText('Advanced Conversion Settings')).toBeDefined();
    expect(screen.getByText('Video Codec:')).toBeDefined();
    expect(screen.getByText('Audio Codec:')).toBeDefined();
    expect(screen.getByLabelText('No audio (remove audio track)')).toBeDefined();

    // Toggle off
    fireEvent.click(settingsBtn);
    expect(screen.queryByText('Advanced Conversion Settings')).toBeNull();
  });

  it('opens Google Drive file picker when Google Drive button is clicked', () => {
    render(<ConverterPage />);

    const driveBtn = screen.getByText('Google Drive');
    fireEvent.click(driveBtn);

    expect(screen.getByText('Select File from Google Drive')).toBeDefined();
    expect(screen.getByPlaceholderText(/Search files in Google Drive/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeDefined();
  });

  it('handles mobile viewport width (< 640px) by showing compact formats and remaining formats inside more dropdown', () => {
    // Set window.innerWidth to mobile (375px like iPhone SE)
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });

    render(<ConverterPage />);

    // On mobile, primary formats are mp4, avi, mov, mpeg, flv
    expect(screen.getByRole('button', { name: 'mp4' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'avi' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mov' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mpeg' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'flv' })).toBeDefined();

    // "more" button is visible
    const moreBtn = screen.getByRole('button', { name: /more/i });
    expect(moreBtn).toBeDefined();

    // Click "more" button to open dropdown
    fireEvent.click(moreBtn);

    // The other formats are available inside the dropdown
    expect(screen.getByRole('button', { name: '3gp' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'webm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'mkv' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'wmv' })).toBeDefined();

    // Click 3gp in the dropdown
    fireEvent.click(screen.getByRole('button', { name: '3gp' }));

    // Now the more button displays 3gp
    expect(screen.getByRole('button', { name: /3gp/i })).toBeDefined();

    // And 3GP resolutions are available
    expect(screen.getAllByText('176x144').length).toBeGreaterThanOrEqual(1);

    // Reset window.innerWidth back to desktop
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });

  it('sends valid aconv payload without no_audio or acodec and with numeric preset for audio conversion', async () => {
    let sentPayload: any = null;
    class MockWebSocket {
      readyState = 1;
      send = vi.fn((data: string) => {
        if (data === '40') {
          setTimeout(() => {
            if (this.onmessage) this.onmessage({ data: '40' } as any);
          }, 0);
        } else if (data.startsWith('42["encode"')) {
          const parsed = JSON.parse(data.substring(2));
          sentPayload = parsed[1];
        }
      });
      close = vi.fn();
      onopen: (() => void) | null = null;
      onmessage: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onopen) this.onopen();
          if (this.onmessage) this.onmessage({ data: '0{"sid":"xyz"}' });
        }, 0);
      }
    }

    const origWs = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;

    try {
      const job = startEncodingJob(
        's97.video-converter.com',
        'tmp_123.m4a',
        180,
        {
          mediaType: 'audio',
          format: 'mp3',
          preset: 'fourth', // Best (320 kbps)
          vcodec: '',
          acodec: 'mp3',
          noAudio: false,
          audioAdvanced: {
            bitrateType: 'constant',
            constantBitrate: 320,
            variableBitrate: 5,
            sampleRate: 44100,
            channels: 2,
            fadeIn: false,
            fadeOut: false,
            reverse: false,
          },
        },
        {}
      );

      await waitFor(() => {
        expect(sentPayload).not.toBeNull();
      });

      expect(sentPayload.site_id).toBe('aconv');
      expect(sentPayload.codebase_id).toBe('aconv');
      expect(sentPayload.format_type).toBe('audio');
      expect(sentPayload.format).toBe('mp3');
      expect(sentPayload.preset).toBe(3); // numeric 3 for fourth / best
      expect(sentPayload.constant_bitrate).toBe(320);
      expect(sentPayload.sample_rate).toBe(44100);
      expect(sentPayload.channels).toBe(2);
      expect(sentPayload.no_audio).toBeUndefined(); // MUST NOT exist for audio!
      expect(sentPayload.acodec).toBeUndefined(); // MUST NOT exist for audio!
      expect(sentPayload.fastmode).toBe(false);
      expect(sentPayload.preset_priority).toBe(false);

      job.cancel();
    } finally {
      (globalThis as any).WebSocket = origWs;
    }
  });

  it('passes site_id=aconv in chunk upload query params when mediaType is audio', async () => {
    let capturedFlowUrl = '';
    const mockFetch = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/download')) {
        return {
          ok: true,
          status: 206,
          arrayBuffer: async () => new ArrayBuffer(1024),
        } as any;
      }
      if (urlStr.includes('/flow')) {
        capturedFlowUrl = urlStr;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ tmp_filename: 'tmp_file_456.m4a', ff: { duration_in_seconds: 120 } }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const res = await uploadDriveVideoToEncoder(
        'drive-file-123',
        'song.m4a',
        1024,
        's97.video-converter.com',
        {
          mediaType: 'audio',
          chunkSize: 1024,
        }
      );

      expect(res.tmpFilename).toBe('tmp_file_456.m4a');
      expect(capturedFlowUrl).toContain('site_id=aconv');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends preset_priority=true for video encoding jobs and handles process error gracefully', async () => {
    let sentPayload: any = null;
    let registeredCallbacks: any = null;
    let mockWsInstance: any = null;

    class MockWebSocket {
      readyState = 1;
      send = vi.fn((data: string) => {
        if (data === '40') {
          setTimeout(() => {
            if (this.onmessage) this.onmessage({ data: '40' } as any);
          }, 0);
        } else if (data.startsWith('42["encode"')) {
          const parsed = JSON.parse(data.substring(2));
          sentPayload = parsed[1];
        }
      });
      close = vi.fn();
      onopen: (() => void) | null = null;
      onmessage: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        mockWsInstance = this;
        setTimeout(() => {
          if (this.onopen) this.onopen();
          if (this.onmessage) this.onmessage({ data: '0{"sid":"xyz"}' });
        }, 0);
      }
    }

    const origWs = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockWebSocket;

    let receivedError = '';
    try {
      const job = startEncodingJob(
        's63.video-converter.com',
        'preview.mp4',
        10,
        {
          mediaType: 'video',
          format: '3gp',
          preset: 'tv',
          vcodec: 'mpeg4',
          acodec: 'aac',
          noAudio: false,
        },
        {
          onError: (err) => {
            receivedError = err;
          },
        }
      );

      await waitFor(() => {
        expect(sentPayload).not.toBeNull();
      });

      expect(sentPayload.site_id).toBe('vconv');
      expect(sentPayload.format).toBe('3gp');
      expect(sentPayload.preset).toBe('tv');
      expect(sentPayload.preset_priority).toBe(true);

      // Simulate encoder sending "Process error"
      mockWsInstance.onmessage({
        data: '42["encode",{"message_type":"error","error_desc":"Process error"}]',
      });

      expect(receivedError).toContain('Transcoding failed');

      job.cancel();
    } finally {
      (globalThis as any).WebSocket = origWs;
    }
  });

  it('switches to Document mode, renders document formats, and shows document conversion details', () => {
    render(<ConverterPage />);

    const docTab = screen.getByRole('button', { name: 'Document' });
    fireEvent.click(docTab);

    // Document Primary Formats
    expect(screen.getByRole('button', { name: 'pdf' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'docx' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'txt' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'rtf' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'odt' })).toBeDefined();

    // Verify video resolution & audio quality controls are hidden
    expect(screen.queryByText('Resolution:')).toBeNull();
    expect(screen.queryByText('Quality')).toBeNull();

    // Document conversion info card appears
    expect(screen.getByText('Convert from:')).toBeDefined();
    expect(screen.getByText('Target format:')).toBeDefined();

    // Switch format to docx
    const docxBtn = screen.getByRole('button', { name: 'docx' });
    fireEvent.click(docxBtn);

    // Open More dropdown to check extended document formats
    const moreBtn = screen.getByRole('button', { name: /more/i });
    fireEvent.click(moreBtn);

    expect(screen.getByRole('button', { name: 'epub' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'xlsx' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'pptx' })).toBeDefined();

    // Select epub
    const epubBtn = screen.getByRole('button', { name: 'epub' });
    fireEvent.click(epubBtn);

    expect(screen.getAllByText('epub').length).toBeGreaterThanOrEqual(1);
  });

  it('executes document conversion via /api/v1/converter/process', async () => {
    let capturedBody: any = null;
    const origFetch = globalThis.fetch;

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('/api/v1/converter/process')) {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            download_url: 'https://s98.convert.io/convert/d/test_doc.pdf',
            output_filesize: 10240,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input, init);
    }) as any;

    try {
      let completedResult: any = null;
      const job = startEncodingJob(
        's98.convert.io',
        'tmp_notes_123.txt',
        0,
        {
          mediaType: 'document',
          format: 'pdf',
          convertFrom: 'txt',
          preset: 'default',
          vcodec: '',
          acodec: '',
          noAudio: false,
          uid: 'uid_doc_789',
        },
        {
          onComplete: (res) => {
            completedResult = res;
          },
        }
      );

      await waitFor(() => {
        expect(completedResult).not.toBeNull();
      });

      expect(capturedBody).not.toBeNull();
      expect(capturedBody.encoder).toBe('s98.convert.io');
      expect(capturedBody.siteId).toBe('convert');
      expect(capturedBody.convertFrom).toBe('txt');
      expect(capturedBody.convertTo).toBe('pdf');
      expect(capturedBody.tmpFilename).toBe('tmp_notes_123.txt');
      expect(completedResult.downloadUrl).toBe('https://s98.convert.io/convert/d/test_doc.pdf');
      expect(completedResult.filesize).toBe(10240);

      job.cancel();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('formats converted document browserFilename using originalFilename', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/v1/converter/process')) {
        return new Response(
          JSON.stringify({
            download_url: 'https://s98.convert.io/convert/d/s98xyz.pdf.docx',
            output_filesize: 24500,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return origFetch(input);
    }) as any;

    try {
      let completedResult: any = null;
      const job = startEncodingJob(
        's98.convert.io',
        'tmp_dummy.pdf',
        0,
        {
          mediaType: 'document',
          format: 'docx',
          convertFrom: 'pdf',
          originalFilename: 'quarterly_report.pdf',
          preset: 'default',
          vcodec: '',
          acodec: '',
          noAudio: false,
        },
        {
          onComplete: (res) => {
            completedResult = res;
          },
        }
      );

      await waitFor(() => {
        expect(completedResult).not.toBeNull();
      });

      expect(completedResult.browserFilename).toBe('quarterly_report.docx');
      job.cancel();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('dynamically adapts document convertFrom and target format based on selected file extension', async () => {
    vi.spyOn(driveApi, 'listDriveItems').mockResolvedValue({
      items: [
        {
          id: 'file_docx_123',
          name: 'financial_report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 25000,
          isFolder: false,
          shared: false,
          trashed: false,
        },
      ],
      nextPageToken: null,
    });

    render(<ConverterPage />);

    // Click Google Drive button to open picker
    const driveBtn = screen.getByText('Google Drive');
    fireEvent.click(driveBtn);

    // Wait for the file to appear in the modal
    await waitFor(() => {
      expect(screen.getByText('financial_report.docx')).toBeDefined();
    });

    // Select the file and click "Choose File"
    fireEvent.click(screen.getByText('financial_report.docx'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose File' }));

    // Verify that the app dynamically adapts to the selected file's extension:
    // "Convert from:" displays "docx" (not hardcoded to pdf)
    // and target format defaults to "pdf" (since source is docx)
    await waitFor(() => {
      expect(screen.getByText('Convert from:')).toBeDefined();
      expect(screen.getAllByText('docx').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('pdf').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('automatically pre-selects a video file transferred from Drive via sessionStorage', async () => {
    const pendingFile = {
      id: 'vid-12345',
      name: '5143bced42c3-preview1.mp4',
      sizeBytes: 6312427, // ~6.02 MiB
      mimeType: 'video/mp4',
      parentFolderId: 'folder-root',
    };

    sessionStorage.setItem('gdu_pending_converter_file', JSON.stringify(pendingFile));

    render(<ConverterPage />);

    await waitFor(() => {
      expect(screen.getByText('5143bced42c3-preview1.mp4')).toBeDefined();
      expect(screen.getByText(/6(\.0)? MB • Google Drive|6\.02 MiB • Google Drive/)).toBeDefined();
    });

    const convertBtn = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convertBtn.disabled).toBe(false);

    expect(sessionStorage.getItem('gdu_pending_converter_file')).toBeNull();
  });

  it('automatically pre-selects an audio file and switches to audio mode', async () => {
    const pendingAudio = {
      id: 'aud-777',
      name: 'podcast_episode_12.mp3',
      sizeBytes: 15000000,
      mimeType: 'audio/mpeg',
    };

    sessionStorage.setItem('gdu_pending_converter_file', JSON.stringify(pendingAudio));

    render(<ConverterPage />);

    await waitFor(() => {
      expect(screen.getByText('podcast_episode_12.mp3')).toBeDefined();
      expect(screen.getByText('Quality')).toBeDefined();
      expect(screen.getByText('Standard')).toBeDefined();
    });

    const convertBtn = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convertBtn.disabled).toBe(false);
  });
});



