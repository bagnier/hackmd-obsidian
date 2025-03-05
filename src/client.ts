import {
  ApiError,
  HackMDError,
  HackMDErrorType,
  HackMDNote,
  HackMDPluginSettings,
  HackMDResponse,
  HackMDUser,
  isHackMDUser,
  NoteOptions,
} from './types';
import { IObsidianService } from './obsidian-service';

// Client for interacting with the HackMD API
export class HackMDClient {
  private readonly baseUrl = 'https://api.hackmd.io/v1';
  private settings: HackMDPluginSettings;

  public constructor(
    settings: HackMDPluginSettings,
    private obsidianService: IObsidianService
  ) {
    this.settings = { ...settings };
  }

  /**
   * Updates the client's settings
   * @param settings The new settings to use
   */
  public updateSettings(settings: HackMDPluginSettings): void {
    this.settings = { ...settings };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.settings.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Validates that the access token is set and the user is authenticated
   * @throws HackMDError if the access token is missing
   */
  public async validateAuth(): Promise<HackMDUser> {
    if (!this.settings.accessToken) {
      throw new HackMDError(HackMDErrorType.AUTH_REQUIRED);
    }
    return await this.getMe();
  }

  /**
   * Makes a request to the HackMD API
   * @param method - HTTP method
   * @param endpoint - API endpoint
   * @param data - Request body data
   * @returns Response from the API
   */
  async request(
    method: string,
    endpoint: string,
    data?: NoteOptions
  ): Promise<HackMDResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await this.obsidianService.requestUrl({
        url,
        method,
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      // Handle special response types
      if (response.status === 204 || response.text.length === 0) {
        return { status: response.status, data: null, ok: true };
      }
      // Process accepted status
      if (response.status === 202) {
        // Create a standardized response object for accepted status
        return { status: 202, data: null, ok: true };
      }

      return {
        status: response.status,
        data: response.json,
        ok: response.status >= 200 && response.status < 300,
      };
    } catch (error) {
      console.error('Request failed:', {
        url,
        method,
        status: error.status,
        message: error.message,
      });

      // Special handling for delete operations
      if (method === 'DELETE' && error.status === 404) {
        return { status: 404, data: null, ok: true };
      }

      throw this.handleApiError(error);
    }
  }

  // Handle API errors with user-friendly HackMDError types
  private handleApiError(error: ApiError): HackMDError {
    // Network or connection errors don't have status
    if (!error.status) {
      return new HackMDError(
        HackMDErrorType.CONNECTION_FAILED,
        undefined,
        0,
        error
      );
    }

    switch (error.status) {
      case 401:
        return new HackMDError(
          HackMDErrorType.AUTH_INVALID,
          undefined,
          401,
          error
        );
      case 403:
        return new HackMDError(
          HackMDErrorType.PERMISSION_DENIED,
          undefined,
          403,
          error
        );
      case 404:
        return new HackMDError(
          HackMDErrorType.NOTE_NOT_FOUND,
          undefined,
          404,
          error
        );
      case 429:
        return new HackMDError(
          HackMDErrorType.RATE_LIMITED,
          undefined,
          429,
          error
        );
      case 500:
      case 502:
      case 503:
      case 504:
        return new HackMDError(
          HackMDErrorType.SERVER_ERROR,
          undefined,
          error.status,
          error
        );
      default:
        return new HackMDError(
          HackMDErrorType.UNKNOWN,
          `Request failed: ${error.message}`,
          error.status,
          error
        );
    }
  }

  // Gets the current user's information
  async getMe(): Promise<HackMDUser> {
    const response = await this.request('GET', '/me');
    if (!response.data || !isHackMDUser(response.data)) {
      throw new HackMDError(
        HackMDErrorType.AUTH_INVALID,
        'Failed to get user information'
      );
    }
    return response.data as HackMDUser;
  }

  // Gets a note by ID
  async getNote(noteId: string): Promise<HackMDNote> {
    const response = await this.request('GET', `/notes/${noteId}`);
    // We'll only check for expected API response shape, not just null
    // This allows response.data to be null in some valid scenarios (like for tests)
    if (response.ok && response.data) {
      return response.data as HackMDNote;
    }
    throw new HackMDError(
      HackMDErrorType.NOTE_NOT_FOUND,
      `Note ${noteId} not found`
    );
  }

  // Creates a new note, applying default permission settings if not specified
  async createNote(options: NoteOptions): Promise<HackMDNote> {
    // Apply default permissions from settings if not explicitly provided
    const createOptions: NoteOptions = {
      ...options,
      readPermission: options.readPermission ?? this.settings.readPermission,
      writePermission: options.writePermission ?? this.settings.writePermission,
      commentPermission:
        options.commentPermission ?? this.settings.commentPermission,
    };

    const response = await this.request('POST', '/notes', createOptions);
    if (!response.data) {
      throw new HackMDError(HackMDErrorType.UNKNOWN, 'Failed to create note');
    }
    return response.data as HackMDNote;
  }

  // Updates an existing note
  async updateNote(noteId: string, options: NoteOptions): Promise<HackMDNote> {
    const response = await this.request('PATCH', `/notes/${noteId}`, options);

    if (response.status === 202) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.getNote(noteId);
    }

    if (!response.data) {
      throw new HackMDError(
        HackMDErrorType.UNKNOWN,
        `Failed to update note ${noteId}`
      );
    }
    return response.data as HackMDNote;
  }

  // Deletes a note
  async deleteNote(noteId: string): Promise<boolean> {
    const response = await this.request('DELETE', `/notes/${noteId}`);
    if (response.status === 404) {
      console.debug(`Note ${noteId} was already deleted or doesn't exist`);
    }
    // Both successful deletion and "already deleted" cases return true
    return true;
  }
}

export function getIdFromUrl(url: string): string | undefined {
  const match = url.match(/hackmd\.io\/(?:@[^/]+\/)?([a-zA-Z0-9_-]+)/);
  return match ? match[1] : undefined;
}

export function getUrlFromId(noteId: string): string {
  return `https://hackmd.io/${noteId}`;
}
