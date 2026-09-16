import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isLocalDevHost,
  isLiveProduction,
  initDisableDevtool,
} from '../../src/web/services/disableDevtool';
import DisableDevtool from 'disable-devtool';

vi.mock('disable-devtool', () => {
  const mockFn = vi.fn(() => ({ success: true, reason: '' }));
  return {
    default: mockFn,
  };
});

describe('disableDevtool security service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isLocalDevHost()', () => {
    it('identifies localhost and subdomains as local dev', () => {
      expect(isLocalDevHost('localhost')).toBe(true);
      expect(isLocalDevHost('sub.localhost')).toBe(true);
      expect(isLocalDevHost('app.dev.localhost')).toBe(true);
    });

    it('identifies IPv4 loopback addresses as local dev', () => {
      expect(isLocalDevHost('127.0.0.1')).toBe(true);
      expect(isLocalDevHost('127.0.0.2')).toBe(true);
      expect(isLocalDevHost('127.1.2.3')).toBe(true);
      expect(isLocalDevHost('0.0.0.0')).toBe(true);
    });

    it('identifies IPv6 loopback addresses as local dev', () => {
      expect(isLocalDevHost('::1')).toBe(true);
      expect(isLocalDevHost('[::1]')).toBe(true);
    });

    it('identifies mDNS .local addresses as local dev', () => {
      expect(isLocalDevHost('myserver.local')).toBe(true);
      expect(isLocalDevHost('pc.local')).toBe(true);
    });

    it('identifies RFC 1918 private IPv4 networks as local dev', () => {
      // 10.0.0.0/8
      expect(isLocalDevHost('10.0.0.1')).toBe(true);
      expect(isLocalDevHost('10.254.1.50')).toBe(true);

      // 172.16.0.0/12
      expect(isLocalDevHost('172.16.0.1')).toBe(true);
      expect(isLocalDevHost('172.24.10.5')).toBe(true);
      expect(isLocalDevHost('172.31.255.255')).toBe(true);

      // 192.168.0.0/16
      expect(isLocalDevHost('192.168.1.1')).toBe(true);
      expect(isLocalDevHost('192.168.0.100')).toBe(true);
    });

    it('identifies empty or missing hostnames as local dev', () => {
      expect(isLocalDevHost('')).toBe(true);
      expect(isLocalDevHost('   ')).toBe(true);
    });

    it('identifies live production public hostnames correctly', () => {
      expect(isLocalDevHost('drvsnc.my-files-directory.workers.dev')).toBe(false);
      expect(isLocalDevHost('mydomain.com')).toBe(false);
      expect(isLocalDevHost('app.clouddrive.io')).toBe(false);
      expect(isLocalDevHost('104.21.55.2')).toBe(false);
      expect(isLocalDevHost('8.8.8.8')).toBe(false);
    });
  });

  describe('isLiveProduction()', () => {
    it('returns false when running inside test environment', () => {
      expect(isLiveProduction()).toBe(false);
      expect(isLiveProduction({ isTest: true })).toBe(false);
    });

    it('returns false when not in production build mode', () => {
      expect(
        isLiveProduction({
          isTest: false,
          prod: false,
          mode: 'development',
          hostname: 'drvsnc.my-files-directory.workers.dev',
        })
      ).toBe(false);
    });

    it('returns false when running on localhost even in production mode', () => {
      expect(
        isLiveProduction({
          isTest: false,
          prod: true,
          mode: 'production',
          hostname: 'localhost',
        })
      ).toBe(false);
    });

    it('returns false when running on private LAN IP even in production mode', () => {
      expect(
        isLiveProduction({
          isTest: false,
          prod: true,
          mode: 'production',
          hostname: '192.168.1.25',
        })
      ).toBe(false);
    });

    it('returns true when running on live production host in production mode', () => {
      expect(
        isLiveProduction({
          isTest: false,
          prod: true,
          mode: 'production',
          hostname: 'drvsnc.my-files-directory.workers.dev',
        })
      ).toBe(true);
    });
  });

  describe('initDisableDevtool()', () => {
    it('skips initialization in development/test environment', () => {
      const result = initDisableDevtool();
      expect(result).toBe(false);
      expect(DisableDevtool).not.toHaveBeenCalled();
    });

    it('skips initialization when running locally even in production build', () => {
      const result = initDisableDevtool(undefined, {
        isTest: false,
        prod: true,
        mode: 'production',
        hostname: 'localhost',
      });
      expect(result).toBe(false);
      expect(DisableDevtool).not.toHaveBeenCalled();
    });

    it('successfully invokes DisableDevtool with options on live production', () => {
      const options = { disableMenu: true, md5: 'test-hash' };
      const result = initDisableDevtool(options, {
        isTest: false,
        prod: true,
        mode: 'production',
        hostname: 'drvsnc.my-files-directory.workers.dev',
      });

      expect(result).toBe(true);
      expect(DisableDevtool).toHaveBeenCalledTimes(1);
      expect(DisableDevtool).toHaveBeenCalledWith(options);
    });

    it('catches and logs errors gracefully if DisableDevtool throws', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(DisableDevtool).mockImplementationOnce(() => {
        throw new Error('Mock initialization error');
      });

      const result = initDisableDevtool(undefined, {
        isTest: false,
        prod: true,
        mode: 'production',
        hostname: 'drvsnc.my-files-directory.workers.dev',
      });

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to initialize disable-devtool:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
