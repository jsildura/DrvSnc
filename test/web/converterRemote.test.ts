import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStreamTicket,
  importRemoteVideoToEncoder,
  startEncodingJob,
  cleanConvertedFilename,
} from '../../src/web/converter/converterClient';
import { CreateRemoteJobSchema } from '../../src/shared/contracts';
import * as apiClient from '../../src/web/api/client';

describe('Remote Video Conversion & Direct Streaming', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createStreamTicket posts file details to /api/v1/converter/stream-ticket', async () => {
    const apiSpy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue({
      ticket: 'test-hmac-ticket',
      streamUrl: 'https://test-worker.dev/api/v1/converter/stream/sample.mp4?ticket=test-hmac-ticket',
      expiresAt: Date.now() + 3600000,
    });

    const res = await createStreamTicket('drive-file-123', 'sample.mp4');

    expect(apiSpy).toHaveBeenCalledWith('/api/v1/converter/stream-ticket', {
      method: 'POST',
      body: JSON.stringify({ fileId: 'drive-file-123', filename: 'sample.mp4' }),
    });

    expect(res.ticket).toBe('test-hmac-ticket');
    expect(res.streamUrl).toContain('sample.mp4');
  });

  it('importRemoteVideoToEncoder opens WebSocket, emits open_remote, and resolves on final_result', async () => {
    const sentMessages: string[] = [];
    let mockWsInstance: any = null;

    class MockWebSocket {
      readyState = 1; // WebSocket.OPEN
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: any }) => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor() {
        mockWsInstance = this;
        setTimeout(() => {
          this.onopen?.();
          // Engine.IO handshake
          this.onmessage?.({ data: '0{"sid":"mock-sid","pingInterval":25000,"pingTimeout":20000}' });
        }, 10);
      }

      send(data: string) {
        sentMessages.push(data);

        // When client sends Socket.IO connect packet "40", server responds with "40"
        if (data === '40') {
          setTimeout(() => {
            this.onmessage?.({ data: '40' });
          }, 10);
        }

        // When client emits "open_remote"
        if (data.startsWith('42["open_remote"')) {
          setTimeout(() => {
            // Emit progress event
            this.onmessage?.({
              data: '42["open_remote",{"message_type":"progress","progress_value":"45"}]',
            });

            // Emit final_result
            this.onmessage?.({
              data: '42["open_remote",{"message_type":"final_result","tmp_filename":"vconv_tmp_789.mp4","ff":{"duration_in_seconds":125.4}}]',
            });
          }, 20);
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    const progressValues: number[] = [];
    const task = importRemoteVideoToEncoder(
      's95.video-converter.com',
      'https://worker.dev/stream.mp4?ticket=123',
      'sample.mp4',
      {
        uid: 'test-uid',
        onProgress: (p) => progressValues.push(p),
      }
    );

    const result = await task.promise;

    expect(result.tmpFilename).toBe('vconv_tmp_789.mp4');
    expect(result.durationInSeconds).toBe(125.4);
    expect(progressValues).toContain(45);

    // Verify open_remote payload was sent
    const openRemotePacket = sentMessages.find((m) => m.startsWith('42["open_remote"'));
    expect(openRemotePacket).toBeDefined();
    expect(openRemotePacket).toContain('https://worker.dev/stream.mp4?ticket=123');
    expect(openRemotePacket).toContain('sample.mp4');
  });

  it('startEncodingJob sends preset_priority: true, preset: hd720p, vcodec: h265, and computed vb for video jobs', async () => {
    const sentMessages: string[] = [];
    let mockWsInstance: any = null;

    class MockWebSocket {
      readyState = 1; // WebSocket.OPEN
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: any }) => void) | null = null;
      onerror: ((err: any) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor() {
        mockWsInstance = this;
        setTimeout(() => {
          this.onopen?.();
          // Engine.IO handshake
          this.onmessage?.({ data: '0{"sid":"mock-enc-sid"}' });
        }, 10);
      }

      send(data: string) {
        sentMessages.push(data);

        if (data === '40') {
          setTimeout(() => {
            this.onmessage?.({ data: '40' });
          }, 10);
        }

        if (data.startsWith('42["encode"')) {
          setTimeout(() => {
            this.onmessage?.({
              data: '42["encode",{"message_type":"final_result","download_url":"https://s72.video-converter.com/vconv/d/converted.mp4","browser_filename":"converted.mp4"}]',
            });
          }, 20);
        }
      }

      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    let completedResult: any = null;
    await new Promise<void>((resolve) => {
      startEncodingJob(
        's72.video-converter.com',
        'tmp_video_123.mp4',
        20, // 20s duration
        {
          mediaType: 'video',
          format: 'mp4',
          preset: 'hd720p',
          vcodec: 'h265',
          acodec: 'aac',
          noAudio: false,
          targetFilesizeMb: 11,
          ab: 80,
        },
        {
          onComplete: (res) => {
            completedResult = res;
            resolve();
          },
        }
      );
    });

    expect(completedResult).toBeDefined();
    expect(completedResult.browserFilename).toBe('converted.mp4');

    // Inspect the emitted encode packet
    const encodePacketStr = sentMessages.find((m) => m.startsWith('42["encode"'));
    expect(encodePacketStr).toBeDefined();

    const parsedPacket = JSON.parse(encodePacketStr!.substring(2));
    expect(parsedPacket[0]).toBe('encode');
    const payload = parsedPacket[1];

    expect(payload.format_type).toBe('video');
    expect(payload.format).toBe('mp4');
    expect(payload.preset).toBe('hd720p');
    expect(payload.vcodec).toBe('h265');
    expect(payload.acodec).toBe('aac');
    expect(payload.preset_priority).toBe(true); // MUST be true!
    expect(payload.vb).toBeGreaterThanOrEqual(4000); // ~4426 kbps computed for 11 MB in 20s
    expect(payload.ab).toBe(80);
    expect(payload.ac).toBe(1); // 80 kbps mono
    expect(payload.ar).toBe(44100);
  });

  describe('cleanConvertedFilename & Remote Job Schema Validation', () => {
    it('strips query parameters and tickets from serverFilename when saving to Google Drive', () => {
      const dirtyServerFilename =
        'd65dbd2f0610d65dbd2f0610d65dbd2f0610d65dbd2f0610.mp4?ticket=eyJmaWQiOiIxRE9oUW9FRGFrZV84VjZwSXh4YkEzVzZzVThfRVNid1giLCJ1aWQiOiI4MmM4YWQ4ODdjYjliNjNkZjU0ZTZlZWRkNzJiOWQ5NiIsImZuIjoiZDY1ZGJkMmYwNjEwZDY1ZGJkMmYwNjEwZDY1ZGJkMmYwNjEwZDY1ZGJkMmYwNjEwLm1wNCIsImV.mp4';

      const cleaned = cleanConvertedFilename(undefined, dirtyServerFilename, 'mp4');

      expect(cleaned).toBe('d65dbd2f0610d65dbd2f0610d65dbd2f0610d65dbd2f0610.mp4');
      expect(cleaned.length).toBeLessThanOrEqual(255);

      // Verify that CreateRemoteJobSchema accepts it without throwing "Too big: expected string to have <=255 characters"
      const parsed = CreateRemoteJobSchema.safeParse({
        url: 'https://s72.video-converter.com/vconv/d/converted.mp4',
        filename: cleaned,
      });
      expect(parsed.success).toBe(true);
    });

    it('prefers originalFilename and updates extension to target format', () => {
      const original = 'My Favorite Vacation Video 2026.MOV';
      const dirtyServerFilename = 'vconv_converted_random123.mp4?ticket=secret';

      const cleaned = cleanConvertedFilename(original, dirtyServerFilename, 'mkv');

      expect(cleaned).toBe('My Favorite Vacation Video 2026.mkv');
      expect(cleaned.length).toBeLessThanOrEqual(255);
    });

    it('enforces total filename length <= 255 characters even with giant names', () => {
      const hugeName = 'a'.repeat(300) + '.mp4';

      const cleaned = cleanConvertedFilename(hugeName, undefined, 'mp4');

      expect(cleaned.length).toBeLessThanOrEqual(255);
      expect(cleaned.endsWith('.mp4')).toBe(true);

      const parsed = CreateRemoteJobSchema.safeParse({
        url: 'https://s72.video-converter.com/vconv/d/converted.mp4',
        filename: cleaned,
      });
      expect(parsed.success).toBe(true);
    });

    it('replaces illegal filesystem and cloud characters with underscores', () => {
      const dirtyName = 'my<video>:file*name?test"with|illegal/chars\\and%percent.avi';

      const cleaned = cleanConvertedFilename(dirtyName, undefined, 'mp4');

      expect(cleaned).not.toMatch(/[/\\?%*:|"<>]/);
      expect(cleaned.endsWith('.mp4')).toBe(true);
    });
  });
});
