import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackMDClient } from '../src/client';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import { DEFAULT_SETTINGS, HackMDNote } from '../src/types';

/**
 * Style: Integration tests with fixtures
 * Technique: toMatchSnapshot to validate complex structures
 */
describe('HackMDClient Integration', () => {
  // Fixture - reusable test data
  const fixtures = {
    user: {
      id: 'test-user-id',
      name: 'Test User',
      userPath: 'test-user',
    },
    notes: [
      {
        id: 'note-1',
        title: 'First Test Note',
        content: '# First Note\nThis is a test note.',
        createdAt: '2023-01-01T00:00:00Z',
      },
      {
        id: 'note-2',
        title: 'Second Test Note',
        content: '# Second Note\nThis is another test note.',
        createdAt: '2023-01-02T00:00:00Z',
        lastChangedAt: '2023-01-03T00:00:00Z',
        teamPath: 'team/path',
      },
    ] as HackMDNote[],
  };

  let mockObsidianService: MockObsidianService;
  let client: HackMDClient;

  beforeEach(async () => {
    // Constant date for snapshots
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-15T12:00:00Z'));

    mockObsidianService = new MockObsidianService();

    // Configure getMe
    mockObsidianService.mockSuccessfulApiResponse(fixtures.user);

    // Create and authenticate client
    client = new HackMDClient({...DEFAULT_SETTINGS, accessToken: 'test-token'}, mockObsidianService);
    await client.getMe();
    mockObsidianService.requestUrl.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should support creating a note and then updating its content', async () => {
    // GIVEN - a note we want to create
    mockObsidianService.mockSuccessfulApiResponse(fixtures.notes[0]);

    // WHEN - we create a note with initial content
    const newNote = await client.createNote({
      title: 'New Test Note',
      content: '# New Note Content',
    });

    // THEN - we get back a valid note with details from the server
    expect(newNote).toHaveProperty('id', fixtures.notes[0].id);
    expect(newNote).toHaveProperty('title', fixtures.notes[0].title);
    expect(newNote).toHaveProperty('content', fixtures.notes[0].content);

    // WHEN - we decide to update the note's content
    mockObsidianService.requestUrl.mockReset();

    // Mock a successful update response directly (status 200) to avoid the 202 flow with delay
    mockObsidianService.mockSuccessfulApiResponse(fixtures.notes[1]);

    const updatedNote = await client.updateNote(newNote.id, {
      content: '# Updated Content',
    });

    // THEN - the note is updated successfully with the new details
    expect(updatedNote).toHaveProperty('id', fixtures.notes[1].id);
    expect(updatedNote).toHaveProperty('title', fixtures.notes[1].title);
    expect(updatedNote).toHaveProperty(
      'lastChangedAt',
      fixtures.notes[1].lastChangedAt
    );
    expect(updatedNote).toHaveProperty('teamPath', fixtures.notes[1].teamPath);
  });
});
