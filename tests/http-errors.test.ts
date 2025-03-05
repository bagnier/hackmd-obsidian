import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HackMDClient } from '../src/client';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import { DEFAULT_SETTINGS, HackMDErrorType } from '../src/types';

describe('HackMDClient Error Handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('HTTP error status handling', () => {
    // Success response mock for authentication
    const successGetMeResponse = {
      status: 200,
      json: {
        id: 'user-id',
        name: 'Test User',
        userPath: 'test-path',
      },
      text: JSON.stringify({
        id: 'user-id',
        name: 'Test User',
        userPath: 'test-path',
      }),
    };

    // Test cases for HTTP error handling
    it.each([
      {
        status: 401,
        message: 'Unauthorized',
        expectedType: HackMDErrorType.AUTH_INVALID,
      },
      {
        status: 403,
        message: 'Forbidden',
        expectedType: HackMDErrorType.PERMISSION_DENIED,
      },
      {
        status: 404,
        message: 'Not Found',
        expectedType: HackMDErrorType.NOTE_NOT_FOUND,
      },
      {
        status: 429,
        message: 'Too Many Requests',
        expectedType: HackMDErrorType.RATE_LIMITED,
      },
      {
        status: 500,
        message: 'Internal Server Error',
        expectedType: HackMDErrorType.SERVER_ERROR,
      },
      {
        status: undefined,
        message: 'Network failure',
        expectedType: HackMDErrorType.CONNECTION_FAILED,
        expectedStatusCode: 0,
      },
      {
        status: 418,
        message: "I'm a teapot",
        expectedType: HackMDErrorType.UNKNOWN,
      },
    ])(
      'should handle $status $message as $expectedType',
      async ({ status, message, expectedType, expectedStatusCode }) => {
        // Create a fresh mock for this test
        const mockObsidianService = new MockObsidianService();

        // Configure mock to return success and then error
        mockObsidianService.requestUrl
          .mockResolvedValueOnce(successGetMeResponse)
          .mockRejectedValueOnce({
            status,
            message,
          });

        // Create client & test
        const client = new HackMDClient({...DEFAULT_SETTINGS, accessToken: 'test-token'}, mockObsidianService);
        await client.getMe();

        await expect(
          client.request('GET', '/api/endpoint')
        ).rejects.toMatchObject({
          type: expectedType,
          statusCode:
            expectedStatusCode !== undefined ? expectedStatusCode : status,
        });
      }
    );
  });
});
