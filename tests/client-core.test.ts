import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackMDClient } from '../src/client';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import { HackMDErrorType } from '../src/types';

describe('HackMDClient Core', () => {
  // Common configuration
  let mockObsidianService: MockObsidianService;

  // Test fixtures
  const validUserResponse = {
    id: 'user-id',
    name: 'Test User',
    userPath: 'test-path',
  };

  /**
   * Helper to create an authenticated client instance for testing
   */
  async function createAuthenticatedClient(
    token = 'test-token'
  ): Promise<HackMDClient> {
    mockObsidianService.mockSuccessfulApiResponse(validUserResponse);
    const client = new HackMDClient(token, mockObsidianService);
    await client.getMe();
    mockObsidianService.requestUrl.mockReset();
    return client;
  }

  beforeEach(async () => {
    // Create a new mock service instance
    mockObsidianService = new MockObsidianService();

    // Reset all mocks
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Clean up after each test
    vi.resetAllMocks();
  });

  describe('authentication', () => {
    it('should throw error when no access token is provided', async () => {
      // GIVEN - a client with empty token
      const client = new HackMDClient('', mockObsidianService);

      // WHEN/THEN - attempting to authenticate
      await expect(client.resetInstance('')).rejects.toMatchObject({
        type: HackMDErrorType.AUTH_REQUIRED,
        message: expect.stringContaining('access token is required'),
      });
    });

    it('should create a valid instance with token', async () => {
      // GIVEN - a configuration to simulate a successful response
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);

      // WHEN - instantiating the client
      const client = new HackMDClient('test-token', mockObsidianService);

      // THEN - a valid client instance is created
      expect(client).toBeInstanceOf(HackMDClient);

      // Verify behavior: client can be used to perform operations
      await client.getMe();
      mockObsidianService.requestUrl.mockReset();
      mockObsidianService.mockSuccessfulApiResponse({ id: 'test-id' });
      await expect(client.getNote('test-id')).resolves.not.toThrow();
    });

    it('should allow changing to a different valid token', async () => {
      // GIVEN - an existing client with first token
      const client = await createAuthenticatedClient('first-token');

      // AND - prepare successful response for the second request
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);

      // WHEN - resetting instance with a different token
      await client.resetInstance('second-token');

      // THEN - the client is updated with new token and remains functional
      expect(client).toBeInstanceOf(HackMDClient);

      // Verify the client can still perform operations
      mockObsidianService.requestUrl.mockReset();
      mockObsidianService.mockSuccessfulApiResponse({ id: 'test-id' });
      await expect(client.getNote('test-id')).resolves.not.toThrow();
    });

    it('should throw auth error when API rejects', async () => {
      // GIVEN - a configuration to simulate an authentication error
      mockObsidianService.mockFailedApiResponse(401, 'Invalid token');
      const client = new HackMDClient('bad-token', mockObsidianService);

      // WHEN/THEN - authentication should fail with the appropriate error details
      await expect(client.getMe()).rejects.toMatchObject({
        type: HackMDErrorType.AUTH_INVALID,
        message: expect.stringContaining('token appears to be invalid'),
        statusCode: 401,
        originalError: expect.objectContaining({
          status: 401,
          message: 'Invalid token',
        }),
      });

      // Verify reset behavior by successfully creating another instance
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);
      await expect(client.resetInstance('new-token')).resolves.not.toThrow();
    });
  });

  describe('getMe', () => {
    it('should return user object from API response', async () => {
      // GIVEN - a preconfigured client
      const client = await createAuthenticatedClient();
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);

      // WHEN - getting user information
      const user = await client.getMe();

      // THEN - the user data should match expected response
      expect(user).toEqual(validUserResponse);
    });

    it('should throw error when user response is invalid', async () => {
      // GIVEN - a preconfigured client
      const client = await createAuthenticatedClient();

      // Mock invalid response (missing required fields)
      mockObsidianService.mockSuccessfulApiResponse({ incorrect: 'data' });

      // WHEN/THEN - operation should fail with proper error
      await expect(client.getMe()).rejects.toMatchObject({
        type: HackMDErrorType.AUTH_INVALID,
        message: expect.stringContaining('Failed to get user information'),
      });
    });
  });

  describe('request', () => {
    it('should handle asynchronous operations with 202 status codes', async () => {
      // GIVEN - a preconfigured client
      const client = await createAuthenticatedClient();

      // AND - an asynchronous operation response
      mockObsidianService.requestUrl.mockResolvedValueOnce({
        status: 202,
        text: '',
      });

      // WHEN - we perform an operation that will be processed asynchronously
      const response = await client.request('POST', '/test-accepted');

      // THEN - we receive a standardized response indicating the request was accepted
      expect(response.status).toBe(202);
      expect(response.ok).toBe(true);
      expect(response.data).toBeNull();

      // WHEN - we receive a 202 response with a body (unusual but possible)
      mockObsidianService.requestUrl.mockResolvedValueOnce({
        status: 202,
        text: 'some-text',
      });

      const response2 = await client.request(
        'POST',
        '/test-accepted-with-body'
      );

      // THEN - the response still follows the standardized format
      expect(response2.status).toBe(202);
      expect(response2.ok).toBe(true);
      expect(response2.data).toBeNull();
    });
  });
});
