import { describe, expect, it, vi } from 'vitest';
import { HackMDClient } from '../src/client';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import { DEFAULT_SETTINGS, HackMDErrorType } from '../src/types';

// Test each error type in separate describe blocks
describe('HTTP 401 Error Handling', () => {
  it('should map 401 status to AUTH_INVALID error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 401,
      message: 'Unauthorized',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.AUTH_INVALID,
        statusCode: 401,
      }
    );
  });
});

describe('HTTP 403 Error Handling', () => {
  it('should map 403 status to PERMISSION_DENIED error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 403,
      message: 'Forbidden',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.PERMISSION_DENIED,
        statusCode: 403,
      }
    );
  });
});

describe('HTTP 404 Error Handling', () => {
  it('should map 404 status to NOTE_NOT_FOUND error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 404,
      message: 'Not Found',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.NOTE_NOT_FOUND,
        statusCode: 404,
      }
    );
  });
});

describe('HTTP 429 Error Handling', () => {
  it('should map 429 status to RATE_LIMITED error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 429,
      message: 'Too Many Requests',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.RATE_LIMITED,
        statusCode: 429,
      }
    );
  });
});

describe('HTTP 500 Error Handling', () => {
  it('should map 500 status to SERVER_ERROR error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 500,
      message: 'Internal Server Error',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.SERVER_ERROR,
        statusCode: 500,
      }
    );
  });
});

describe('Network Error Handling', () => {
  it('should map network failures to CONNECTION_FAILED error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      message: 'Network failure',
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.CONNECTION_FAILED,
        statusCode: 0,
      }
    );
  });
});

describe('Unknown Error Handling', () => {
  it('should map unknown status codes to UNKNOWN error type', async () => {
    const mockService = new MockObsidianService();
    const client = new HackMDClient(
      { ...DEFAULT_SETTINGS, accessToken: 'test-token' },
      mockService
    );

    mockService.requestUrl.mockRejectedValueOnce({
      status: 418,
      message: "I'm a teapot",
    });

    await expect(client.request('GET', '/test-endpoint')).rejects.toMatchObject(
      {
        type: HackMDErrorType.UNKNOWN,
        statusCode: 418,
      }
    );
  });
});
