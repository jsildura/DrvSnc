import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStreamTicket, importRemoteVideoToEncoder } from '../../src/web/converter/converterClient';
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
});
