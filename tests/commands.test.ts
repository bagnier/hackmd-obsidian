import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Commands } from '../src/commands';
import { IEditor, IFile } from '../src/obsidian-service';
import { MockObsidianService } from './mocks/obsidian-service.mock';
import {
  HackMDError,
  HackMDErrorType,
  HackMDNote,
  SYNC_TIME_MARGIN,
} from '../src/types';
// Import the mocked functions after mocking
import { getIdFromUrl, getUrlFromId } from '../src/client';

// Mock the client module
vi.mock('../src/client', async importOriginal => {
  const actual = (await importOriginal()) as typeof import('../src/client');
  return {
    ...actual,
    HackMDClient: vi.fn(),
  };
});

describe('Commands', () => {
  let commands: Commands;
  let mockObsidianService: MockObsidianService;
  let mockHackMDClient: any;
  let mockFile: IFile;
  const mockEditor = {
    getValue: vi.fn() as any,
    setValue: vi.fn() as any,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockObsidianService = new MockObsidianService();

    // Create mock HackMDClient with direct methods
    mockHackMDClient = {
      getNote: vi.fn(),
      updateNote: vi.fn(),
      createNote: vi.fn(),
      deleteNote: vi.fn(),
      updateSettings: vi.fn(),
      validateAuth: vi.fn(),
    };

    // Create Commands instance with dependency injection
    commands = new Commands(mockObsidianService, mockHackMDClient);

    mockFile = {
      basename: 'test-note',
      path: 'test-note.md',
      mtime: Date.now(),
    };

    // Default editor content with frontmatter
    mockEditor.getValue.mockReturnValue(`---
title: Test Note
---
# Test Content`);

    // Setup Obsidian service mocks for file reading
    mockObsidianService.readFile.mockImplementation(() =>
      mockEditor.getValue()
    );

    // Default YAML parsing implementation
    mockObsidianService.parseYaml.mockImplementation((yaml: string) => {
      try {
        return JSON.parse(yaml.replace(/(\w+):/g, '"$1":'));
      } catch {
        return {};
      }
    });

    // Default YAML stringify implementation
    mockObsidianService.stringifyYaml.mockImplementation((obj: any) => {
      const formatted = JSON.stringify(obj, null, 2)
        .replace(/"([^"]+)":/g, '$1:')
        .replace(/"/g, '');
      return formatted;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('pushToHackMD', () => {
    it('should create a new note when no noteId exists', async () => {
      // Setup
      const testContent = `---
title: Test Note
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Extract the content without frontmatter for the createNote mock
      const contentWithoutFrontmatter = testContent.split('---')[2].trim();

      // Mock the expected note return value
      const expectedNote: HackMDNote = {
        id: 'new-note-id',
        title: 'Test Note',
        content: contentWithoutFrontmatter,
        createdAt: new Date().toISOString(),
      };

      // Mock the createNote method to return our expected note
      mockHackMDClient.createNote.mockResolvedValue(expectedNote);

      // Execute
      await commands.pushToHackMD(mockEditor, mockFile);

      // Verify
      expect(mockHackMDClient.createNote).toHaveBeenCalled();
      expect(mockEditor.setValue).toHaveBeenCalled();
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully pushed to HackMD!'
      );
    });

    it('should update an existing note when noteId exists', async () => {
      // Setup
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${new Date(Date.now() - SYNC_TIME_MARGIN * 2).toISOString()}
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Extract the content without frontmatter for comparison
      const contentWithoutFrontmatter = testContent.split('---')[2].trim();

      // Mock YAML parsing to extract the noteId correctly
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: new Date(Date.now() - SYNC_TIME_MARGIN * 2).toISOString(),
      }));

      // Mock getNote to return a valid response for conflict check
      mockHackMDClient.getNote.mockResolvedValue({
        id: 'existing-note-id',
        title: 'Test Note',
        content: '# Old Content',
        createdAt: new Date(Date.now() - SYNC_TIME_MARGIN * 3).toISOString(),
        lastChangedAt: new Date(
          Date.now() - SYNC_TIME_MARGIN * 3
        ).toISOString(),
      });

      // Mock updateNote to return a valid response
      mockHackMDClient.updateNote.mockResolvedValue({
        id: 'existing-note-id',
        content: contentWithoutFrontmatter,
        createdAt: new Date().toISOString(),
      });

      // Execute
      await commands.pushToHackMD(mockEditor, mockFile);

      // Verify
      expect(mockHackMDClient.updateNote).toHaveBeenCalledWith(
        'existing-note-id',
        expect.any(String)
      );
      expect(mockEditor.setValue).toHaveBeenCalled();
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully pushed to HackMD!'
      );
    });

    it('should throw conflict error when remote note was modified after last sync', async () => {
      // Setup
      const lastSyncDate = new Date(Date.now() - SYNC_TIME_MARGIN * 2);
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to extract the noteId correctly
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // The logic in checkPushConflicts is incorrect - it should be remoteModTime - lastSyncTime > SYNC_TIME_MARGIN
      // Mock a response where the remote note was modified after the last sync
      mockHackMDClient.getNote.mockResolvedValue({
        id: 'existing-note-id',
        title: 'Test Note',
        content: '# Old Content',
        createdAt: new Date(Date.now() - SYNC_TIME_MARGIN * 3).toISOString(),
        lastChangedAt: new Date(Date.now()).toISOString(), // Very recent change (now)
      });

      // Mock updateNote to simulate a conflict error before we reach that method
      mockHackMDClient.updateNote.mockImplementation(() => {
        throw new HackMDError(HackMDErrorType.SYNC_CONFLICT_REMOTE);
      });

      // Execute and Verify
      await expect(commands.pushToHackMD(mockEditor, mockFile)).rejects.toThrow(
        HackMDError
      );

      expect(mockHackMDClient.updateNote).not.toHaveBeenCalled();
    });

    it('should bypass conflict check with force mode', async () => {
      // Setup
      const lastSyncDate = new Date(Date.now() - SYNC_TIME_MARGIN * 2);
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Extract the content without frontmatter for comparison
      const contentWithoutFrontmatter = testContent.split('---')[2].trim();

      // Mock YAML parsing to extract the noteId correctly
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // Remote note was modified after last sync
      mockHackMDClient.getNote.mockResolvedValue({
        id: 'existing-note-id',
        title: 'Test Note',
        content: '# Old Content',
        createdAt: new Date(Date.now() - SYNC_TIME_MARGIN * 3).toISOString(),
        lastChangedAt: new Date(
          Date.now() - SYNC_TIME_MARGIN / 2
        ).toISOString(), // Very recent change
      });

      // Mock updateNote to return a valid response
      mockHackMDClient.updateNote.mockResolvedValue({
        id: 'existing-note-id',
        title: 'Test Note Updated',
        content: contentWithoutFrontmatter,
        createdAt: new Date().toISOString(),
      });

      // Execute
      await commands.pushToHackMD(mockEditor, mockFile, 'force');

      // Verify
      expect(mockHackMDClient.updateNote).toHaveBeenCalledWith(
        'existing-note-id',
        expect.any(String)
      );
      expect(mockEditor.setValue).toHaveBeenCalled();
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully pushed to HackMD!'
      );
    });
  });

  describe('pullFromHackMD', () => {
    it('should throw error when note is not linked to HackMD', async () => {
      // Setup
      const testContent = `---
title: Test Note
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Execute and Verify
      await expect(
        commands.pullFromHackMD(mockEditor, mockFile)
      ).rejects.toThrow(new HackMDError(HackMDErrorType.SYNC_NOT_LINKED));
    });

    it('should pull content from HackMD when linked', async () => {
      // Setup - Note with URL and lastSync
      const lastSyncDate = new Date(Date.now() - SYNC_TIME_MARGIN * 2);
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Local Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to correctly extract the frontmatter with URL
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // Set file mtime to be older than lastSync to avoid local conflict error
      mockFile.mtime = Date.now() - SYNC_TIME_MARGIN * 3;

      const remoteNote: HackMDNote = {
        id: 'existing-note-id',
        title: 'Remote Title',
        content: '# Remote Content',
        createdAt: new Date(Date.now() - SYNC_TIME_MARGIN * 3).toISOString(),
        lastChangedAt: new Date(
          Date.now() - SYNC_TIME_MARGIN * 3
        ).toISOString(),
      };

      mockHackMDClient.getNote.mockResolvedValue(remoteNote);

      // Execute
      await commands.pullFromHackMD(mockEditor, mockFile);

      // Verify
      expect(mockHackMDClient.getNote).toHaveBeenCalledWith('existing-note-id');
      expect(mockEditor.setValue).toHaveBeenCalled();
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully pulled from HackMD!'
      );

      // Verify content was updated
      const setValueCall = mockEditor.setValue.mock.calls[0][0];
      expect(setValueCall).toContain('# Remote Content');
    });

    it('should throw conflict error when local note was modified after last sync', async () => {
      // Setup - Create a note with old lastSync but recent local mtime
      const lastSyncDate = new Date(Date.now() - SYNC_TIME_MARGIN * 2);
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to correctly extract the frontmatter with URL
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // Local file was modified very recently
      mockFile.mtime = Date.now() - SYNC_TIME_MARGIN / 2;

      // Execute and Verify
      await expect(
        commands.pullFromHackMD(mockEditor, mockFile)
      ).rejects.toThrow(HackMDError);

      expect(mockEditor.setValue).not.toHaveBeenCalled();
    });

    it('should bypass conflict check with force mode', async () => {
      // Setup - Create a note with old lastSync but recent local mtime
      const lastSyncDate = new Date(Date.now() - SYNC_TIME_MARGIN * 2);
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Local Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to correctly extract the frontmatter with URL
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // Local file was modified very recently
      mockFile.mtime = Date.now() - SYNC_TIME_MARGIN / 2;

      const remoteNote: HackMDNote = {
        id: 'existing-note-id',
        title: 'Remote Title',
        content: '# Remote Content',
        createdAt: new Date(Date.now() - SYNC_TIME_MARGIN * 3).toISOString(),
      };

      mockHackMDClient.getNote.mockResolvedValue(remoteNote);

      // Execute
      await commands.pullFromHackMD(mockEditor, mockFile, 'force');

      // Verify
      expect(mockHackMDClient.getNote).toHaveBeenCalledWith('existing-note-id');
      expect(mockEditor.setValue).toHaveBeenCalled();
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully pulled from HackMD!'
      );
    });
  });

  describe('copyHackMDUrl', () => {
    it('should throw error when note is not linked to HackMD', async () => {
      // Setup
      const testContent = `---
title: Test Note
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Execute and Verify
      await expect(commands.copyHackMDUrl(mockEditor)).rejects.toThrow(
        new HackMDError(HackMDErrorType.SYNC_NOT_LINKED)
      );
    });

    it('should copy HackMD URL to clipboard when linked', async () => {
      // Setup
      const lastSyncDate = new Date();
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to correctly extract the frontmatter with URL
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
      }));

      // Execute
      await commands.copyHackMDUrl(mockEditor);

      // Verify
      expect(mockObsidianService.copyToClipboard).toHaveBeenCalledWith(
        'https://hackmd.io/existing-note-id'
      );
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'HackMD URL copied to clipboard!'
      );
    });
  });

  describe('createNoteFromHackMDUrl', () => {
    it('should throw error for invalid HackMD URL', async () => {
      // Execute and Verify
      await expect(
        commands.createNoteFromHackMDUrl('https://example.com/not-hackmd')
      ).rejects.toThrow(new HackMDError(HackMDErrorType.INVALID_URL));
    });

    it('should notify and return early if note already exists', async () => {
      // Setup
      const existingFile = {
        basename: 'existing-note',
        path: 'existing-note.md',
        mtime: Date.now(),
      };

      mockObsidianService.findFileByUrlProperty.mockReturnValue(existingFile);

      // Execute
      await commands.createNoteFromHackMDUrl(
        'https://hackmd.io/existing-note-id'
      );

      // Verify
      expect(mockObsidianService.findFileByUrlProperty).toHaveBeenCalledWith(
        'https://hackmd.io/existing-note-id'
      );
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('This note already exists')
      );
      expect(mockObsidianService.openFileInNewTab).toHaveBeenCalledWith(
        existingFile
      );
    });

    it('should create a new note from HackMD URL', async () => {
      // Setup
      mockObsidianService.findFileByUrlProperty.mockReturnValue(null);

      const remoteNote: HackMDNote = {
        id: 'new-note-id',
        title: 'Remote Title',
        content: '# Remote Content',
        createdAt: new Date().toISOString(),
        teamPath: 'team/path',
      };

      mockHackMDClient.getNote.mockResolvedValue(remoteNote);

      mockObsidianService.createAndOpenFileWithUniqueFilename.mockResolvedValue(
        'Remote Title.md'
      );

      // Execute
      await commands.createNoteFromHackMDUrl('https://hackmd.io/new-note-id');

      // Verify
      expect(mockObsidianService.findFileByUrlProperty).toHaveBeenCalledWith(
        'https://hackmd.io/new-note-id'
      );
      expect(mockHackMDClient.getNote).toHaveBeenCalledWith('new-note-id');

      // Should create a new note with the remote content and metadata
      expect(
        mockObsidianService.createAndOpenFileWithUniqueFilename
      ).toHaveBeenCalledWith(
        'Remote Title',
        expect.stringContaining('# Remote Content')
      );

      // Should notify the user
      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Note created: Remote Title.md'
      );
    });
  });

  describe('delete', () => {
    it('should delete remote note and clean up local metadata', async () => {
      // Setup
      const lastSyncDate = new Date();
      const testContent = `---
url: https://hackmd.io/existing-note-id
title: Test Note
lastSync: ${lastSyncDate.toISOString()}
customField: custom value
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Mock YAML parsing to correctly extract the frontmatter with URL
      mockObsidianService.parseYaml.mockImplementation(() => ({
        url: 'https://hackmd.io/existing-note-id',
        title: 'Test Note',
        lastSync: lastSyncDate.toISOString(),
        customField: 'custom value',
      }));

      mockHackMDClient.deleteNote.mockResolvedValue({});

      // Execute
      const deleteFunction = commands.delete(mockEditor);
      await deleteFunction();

      // Verify
      expect(mockHackMDClient.deleteNote).toHaveBeenCalledWith(
        'existing-note-id'
      );

      // Should clean up HackMD metadata but preserve other frontmatter
      expect(mockEditor.setValue).toHaveBeenCalled();
      const newContent = mockEditor.setValue.mock.calls[0][0];
      expect(newContent).toContain('customField: custom value');

      expect(mockObsidianService.notifyUser).toHaveBeenCalledWith(
        'Successfully unlinked note from HackMD!'
      );
    });

    it('should throw error when note is not linked to HackMD', async () => {
      // Setup
      const testContent = `---
title: Test Note
customField: custom value
---
# Test Content`;
      mockEditor.getValue.mockReturnValue(testContent);

      // Execute and Verify
      const deleteFunction = commands.delete(mockEditor);
      await expect(deleteFunction()).rejects.toThrow(
        new HackMDError(HackMDErrorType.SYNC_NOT_LINKED)
      );
    });
  });
});
