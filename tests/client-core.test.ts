import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackMDClient } from '../src/client';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import {
  CommentPermissionType,
  HackMDErrorType,
  HackMDPluginSettings,
  NotePermissionRole,
} from '../src/types';

describe('HackMDClient Core', () => {
  // Common configuration
  let mockObsidianService: MockObsidianService;

  // Test fixtures
  const validUserResponse = {
    id: 'user-id',
    name: 'Test User',
    userPath: 'test-path',
  };

  // Default test settings
  const testSettings: HackMDPluginSettings = {
    accessToken: 'test-token',
    readPermission: NotePermissionRole.OWNER,
    writePermission: NotePermissionRole.OWNER,
    commentPermission: CommentPermissionType.DISABLED,
  };

  /**
   * Helper to create an authenticated client instance for testing
   */
  async function createAuthenticatedClient(
    settings: HackMDPluginSettings = testSettings
  ): Promise<HackMDClient> {
    mockObsidianService.mockSuccessfulApiResponse(validUserResponse);
    const client = new HackMDClient(settings, mockObsidianService);
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
      const client = new HackMDClient(
        {
          ...testSettings,
          accessToken: '',
        },
        mockObsidianService
      );

      // WHEN/THEN - attempting to authenticate
      await expect(client.validateAuth()).rejects.toMatchObject({
        type: HackMDErrorType.AUTH_REQUIRED,
        message: expect.stringContaining('access token is required'),
      });
    });

    it('should create a valid instance with token', async () => {
      // GIVEN - a configuration to simulate a successful response
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);

      // WHEN - instantiating the client
      const client = new HackMDClient(testSettings, mockObsidianService);

      // THEN - a valid client instance is created
      expect(client).toBeInstanceOf(HackMDClient);

      // Verify behavior: client can be used to perform operations
      await client.getMe();
      mockObsidianService.requestUrl.mockReset();
      mockObsidianService.mockSuccessfulApiResponse({ id: 'test-id' });
      await expect(client.getNote('test-id')).resolves.not.toThrow();
    });

    it('should allow updating settings', async () => {
      // GIVEN - an existing client with initial settings
      const client = await createAuthenticatedClient();

      // AND - new settings to apply
      const newSettings: HackMDPluginSettings = {
        ...testSettings,
        accessToken: 'new-token',
        readPermission: NotePermissionRole.GUEST,
      };

      // WHEN - updating settings
      client.updateSettings(newSettings);

      // AND - prepare successful response for the next request
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);

      // THEN - validate authentication with new token
      await client.validateAuth();

      // Verify the client can still perform operations with new token
      mockObsidianService.requestUrl.mockReset();
      mockObsidianService.mockSuccessfulApiResponse({ id: 'test-id' });
      await expect(client.getNote('test-id')).resolves.not.toThrow();

      // Check that authorization header is using the new token
      expect(mockObsidianService.requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer new-token',
          }),
        })
      );
    });

    it('should throw auth error when API rejects', async () => {
      // GIVEN - a configuration to simulate an authentication error
      mockObsidianService.mockFailedApiResponse(401, 'Invalid token');
      const client = new HackMDClient(
        {
          ...testSettings,
          accessToken: 'bad-token',
        },
        mockObsidianService
      );

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

      // Update settings with a new token
      mockObsidianService.mockSuccessfulApiResponse(validUserResponse);
      client.updateSettings({
        ...testSettings,
        accessToken: 'new-token',
      });

      // Should be able to authenticate with new token
      await expect(client.validateAuth()).resolves.not.toThrow();
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

  describe('createNote with permissions', () => {
    it('should apply default permissions from settings', async () => {
      // GIVEN - a client with custom permission settings
      const customSettings = {
        ...testSettings,
        readPermission: NotePermissionRole.GUEST,
        writePermission: NotePermissionRole.SIGNED_IN,
        commentPermission: CommentPermissionType.EVERYONE,
      };

      const client = new HackMDClient(customSettings, mockObsidianService);

      // Mock successful response
      mockObsidianService.mockSuccessfulApiResponse({
        id: 'new-note-id',
        title: 'Test Note',
        content: '# Test Content',
        createdAt: new Date().toISOString(),
      });

      // WHEN - creating a note without explicit permissions
      await client.createNote({
        title: 'Test Note',
        content: '# Test Content',
      });

      // THEN - the client should use permissions from settings
      expect(mockObsidianService.requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          body:
            expect.stringContaining('"readPermission":"Guest"') &&
            expect.stringContaining('"writePermission":"Signed in Users"') &&
            expect.stringContaining('"commentPermission":"everyone"'),
        })
      );
    });

    it('should use explicitly provided permissions over defaults', async () => {
      // GIVEN - a client with default permission settings
      const client = await createAuthenticatedClient();

      // Mock successful response
      mockObsidianService.mockSuccessfulApiResponse({
        id: 'new-note-id',
        title: 'Test Note',
        content: '# Test Content',
        createdAt: new Date().toISOString(),
      });

      // WHEN - creating a note with explicit permissions
      await client.createNote({
        title: 'Test Note',
        content: '# Test Content',
        readPermission: NotePermissionRole.GUEST,
        writePermission: NotePermissionRole.SIGNED_IN,
      });

      // THEN - the client should use the explicitly provided permissions (converted to lowercase for API)
      expect(mockObsidianService.requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          body:
            expect.stringContaining('"readPermission":"guest"') &&
            expect.stringContaining('"writePermission":"signed in users"') &&
            expect.stringContaining('"commentPermission":"disabled"'),
        })
      );
    });
  });
});
