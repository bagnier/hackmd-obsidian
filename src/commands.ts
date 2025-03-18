import { IEditor, IFile, IObsidianService } from './obsidian-service';
import { getIdFromUrl, getUrlFromId, HackMDClient } from './client';
import {
  HackMDError,
  HackMDErrorType,
  HackMDMetadata,
  HackMDNote,
  NoteFrontmatter,
  SYNC_TIME_MARGIN,
  SyncMode,
  SyncPrepareResult,
  UpdateLocalNoteParams,
} from './types';

export class Commands {
  constructor(
    private obsidianService: IObsidianService,
    private hackMDClient: HackMDClient
  ) {}

  public async pushToHackMD(
    editor: IEditor,
    file: IFile,
    mode: SyncMode = 'normal'
  ): Promise<void> {
    const { content, noteId } = await this.prepareSync(editor);
    let result;

    if (noteId) {
      if (mode === 'normal') {
        await this.checkPushConflicts(file, noteId);
      }
      result = await this.hackMDClient.updateNote(noteId, content);
    } else {
      result = await this.pushNewNote(editor, file, content);
    }

    const updatedMetadata: Partial<HackMDMetadata> = {
      url: getUrlFromId(result.id),
      title: result.title || file.basename,
      lastSync: new Date().toISOString(),
    };

    if (result.teamPath) {
      updatedMetadata.teamPath = result.teamPath;
    }

    await this.updateLocalNote({
      editor,
      content,
      metadata: updatedMetadata,
    });

    this.obsidianService.notifyUser('Successfully pushed to HackMD!');
  }

  private async pushNewNote(
    editor: IEditor,
    file: IFile,
    content: string
  ): Promise<HackMDNote> {
    const { frontmatter } = this.getFrontmatter(content);

    const newFrontmatter: NoteFrontmatter = {
      ...frontmatter,
      title: file.basename,
    };

    const contentWithTitle = this.combine(newFrontmatter, content);
    return this.hackMDClient.createNote({
      content: contentWithTitle,
      // No need to explicitly pass permissions - client will use defaults from settings
    });
  }

  /**
   * Prepares note content by adding fresh metadata and preserving non-sync frontmatter
   * @param noteContent The raw content from HackMD
   * @param noteId The HackMD note ID
   * @param noteTitle The note title
   * @param teamPath Optional team path if note belongs to a team
   * @returns Processed content with appropriate metadata
   */
  private prepareNoteContent(
    noteContent: string,
    noteId: string,
    noteTitle: string,
    teamPath?: string
  ): string {
    const { frontmatter } = this.getFrontmatter(noteContent);

    // Always create fresh synchronization metadata for newly imported notes
    // This ensures we don't inherit potentially problematic metadata from other users
    const newMetadata: Partial<HackMDMetadata> = {
      url: getUrlFromId(noteId),
      title: noteTitle,
      lastSync: new Date().toISOString(),
    };

    if (teamPath) {
      newMetadata.teamPath = teamPath;
    }

    // Preserve any existing non-sync frontmatter content
    // But ensure our sync metadata takes precedence
    const existingNonSyncFrontmatter = { ...frontmatter };

    // Remove any existing sync metadata keys that we'll replace
    delete existingNonSyncFrontmatter.url;
    delete existingNonSyncFrontmatter.lastSync;
    delete existingNonSyncFrontmatter.teamPath;

    // Merge non-sync frontmatter with our fresh sync metadata
    const newFrontmatter = { ...existingNonSyncFrontmatter, ...newMetadata };

    // Extract content without frontmatter
    const contentWithoutFrontmatter = frontmatter
      ? noteContent.slice(this.getFrontmatter(noteContent).position)
      : noteContent;

    // Rebuild content with new metadata
    return this.combine(newFrontmatter, contentWithoutFrontmatter);
  }

  /**
   * Notifies the user that a note already exists and suggests next steps
   * @param existingNote The file that already contains this HackMD note
   */
  private notifyExistingNote(existingNote: IFile): void {
    this.obsidianService.notifyUser(
      `This note already exists at "${existingNote.path}". Open it and use the "Pull" command to update its content.`
    );
    // Optionally open the existing note
    this.obsidianService.openFileInNewTab(existingNote);
  }

  /**
   * Shows a notification about note creation
   * @param fileName The name of the created file
   */
  private notifyNoteCreation(fileName: string): void {
    this.obsidianService.notifyUser(`Note created: ${fileName}`);
  }

  /**
   * Creates a note from a HackMD URL
   * @param url The HackMD URL to import
   * @returns Promise that resolves when the operation is complete
   */
  async createNoteFromHackMDUrl(url: string): Promise<void> {
    const noteId = getIdFromUrl(url);

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.INVALID_URL);
    }

    // Check if the note already exists
    const existingNote = this.findNoteWithHackMDId(noteId);

    if (existingNote) {
      this.notifyExistingNote(existingNote);
      return;
    }

    // Get note data
    const noteData = await this.hackMDClient.getNote(noteId);
    const noteTitle = noteData.title || 'Untitled';
    const noteContent = noteData.content || '';

    // Prepare content
    const finalContent = this.prepareNoteContent(
      noteContent,
      noteId,
      noteTitle,
      noteData.teamPath
    );

    const fileName =
      await this.obsidianService.createAndOpenFileWithUniqueFilename(
        noteTitle,
        finalContent
      );

    // Notify user
    this.notifyNoteCreation(fileName);
  }

  private findNoteWithHackMDId(noteId: string): IFile | null {
    const searchUrl = getUrlFromId(noteId);
    return this.obsidianService.findFileByUrlProperty(searchUrl);
  }

  public async pullFromHackMD(
    editor: IEditor,
    file: IFile,
    mode: SyncMode = 'normal'
  ): Promise<void> {
    const { noteId } = await this.prepareSync(editor);

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
    }

    if (mode === 'normal') {
      await this.checkPullConflicts(file);
    }

    const note = await this.hackMDClient.getNote(noteId);
    const updatedMetadata: Partial<HackMDMetadata> = {
      url: getUrlFromId(note.id),
      title: note.title || file.basename,
      lastSync: new Date().toISOString(),
    };

    if (note.teamPath) {
      updatedMetadata.teamPath = note.teamPath;
    }

    await this.updateLocalNote({
      editor: editor,
      content: note.content || '',
      metadata: updatedMetadata,
    });

    this.obsidianService.notifyUser('Successfully pulled from HackMD!');
  }

  public async copyHackMDUrl(editor: IEditor): Promise<void> {
    const { noteId } = await this.prepareSync(editor);

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
    }
    const url = getUrlFromId(noteId);
    await this.obsidianService.copyToClipboard(url);
    this.obsidianService.notifyUser('HackMD URL copied to clipboard!');
  }

  public delete(editor: IEditor) {
    return async () => {
      const { frontmatter } = await this.prepareSync(editor);
      const noteId = frontmatter?.url
        ? getIdFromUrl(frontmatter.url)
        : undefined;

      if (!noteId) {
        throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
      }
      await this.hackMDClient.deleteNote(noteId);
      await this.cleanupHackMDMetadata(editor);
      this.obsidianService.notifyUser(
        'Successfully unlinked note from HackMD!'
      );
    };
  }

  private async prepareSync(editor: IEditor): Promise<SyncPrepareResult> {
    if (!editor) {
      throw new HackMDError(HackMDErrorType.NO_ACTIVE_NOTE);
    }
    const content = editor.getValue();
    const { frontmatter } = this.getFrontmatter(content);
    const noteId = frontmatter?.url ? getIdFromUrl(frontmatter.url) : undefined;
    return { content, frontmatter, noteId };
  }

  private getFrontmatter(content: string): {
    frontmatter: NoteFrontmatter | null;
    content: string;
    position: number;
  } {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!fmMatch) {
      return { frontmatter: null, content, position: 0 };
    }
    try {
      const frontmatter = this.obsidianService.parseYaml(fmMatch[1]);
      const position = fmMatch[0].length;
      const remainingContent = content.slice(position);
      return { frontmatter, content: remainingContent, position };
    } catch (error) {
      console.error('Failed to parse frontmatter:', error);
      return { frontmatter: null, content, position: 0 };
    }
  }

  private async checkPushConflicts(file: IFile, noteId: string): Promise<void> {
    const note = await this.hackMDClient.getNote(noteId);
    const content = await this.obsidianService.readFile(file);
    const { frontmatter } = this.getFrontmatter(content);
    const lastSyncStr = frontmatter?.lastSync;

    if (!lastSyncStr) {
      throw new HackMDError(HackMDErrorType.SYNC_METADATA_MISSING);
    }

    const lastSyncTime = new Date(lastSyncStr).getTime();
    const remoteModTime = new Date(
      note.lastChangedAt || note.createdAt
    ).getTime();

    // Check if remote note was modified after last sync
    if (remoteModTime - lastSyncTime > SYNC_TIME_MARGIN) {
      throw new HackMDError(HackMDErrorType.SYNC_CONFLICT_REMOTE);
    }
  }

  private async checkPullConflicts(file: IFile): Promise<void> {
    const content = await this.obsidianService.readFile(file);
    const { frontmatter } = this.getFrontmatter(content);
    const lastSyncStr = frontmatter?.lastSync;

    if (!lastSyncStr) {
      throw new HackMDError(HackMDErrorType.SYNC_METADATA_MISSING);
    }

    const lastSyncTime = new Date(lastSyncStr).getTime();
    const localModTime = file.mtime;

    if (localModTime - lastSyncTime > SYNC_TIME_MARGIN) {
      throw new HackMDError(HackMDErrorType.SYNC_CONFLICT_LOCAL);
    }
  }

  private async updateLocalNote(params: UpdateLocalNoteParams): Promise<void> {
    const { editor, metadata } = params;
    const baseContent = params.content ?? editor.getValue();
    const { frontmatter, content: noteContent } =
      this.getFrontmatter(baseContent);

    const newFrontmatter: NoteFrontmatter = {
      ...frontmatter,
      ...metadata,
    };

    // Remove empty metadata fields
    Object.keys(newFrontmatter).forEach(key => {
      if (
        newFrontmatter[key] &&
        typeof newFrontmatter[key] === 'object' &&
        Object.keys(newFrontmatter[key]).length === 0
      ) {
        delete newFrontmatter[key];
      }
    });

    const updatedContent =
      Object.keys(newFrontmatter).length > 0
        ? this.combine(newFrontmatter, noteContent)
        : noteContent;

    editor.setValue(updatedContent);
  }

  private async cleanupHackMDMetadata(editor: IEditor): Promise<void> {
    const content = editor.getValue();
    const { frontmatter, content: noteContent } = this.getFrontmatter(content);

    if (frontmatter) {
      // Create a new frontmatter object without HackMD-specific fields
      const cleanedFrontmatter: NoteFrontmatter = { ...frontmatter };
      delete cleanedFrontmatter.url;
      delete cleanedFrontmatter.lastSync;
      delete cleanedFrontmatter.teamPath;
      delete cleanedFrontmatter.title;

      // Only keep frontmatter if there are remaining fields
      if (Object.keys(cleanedFrontmatter).length > 0) {
        const frontmatterAndContent = this.combine(
          cleanedFrontmatter,
          noteContent
        );
        editor.setValue(frontmatterAndContent);
      } else {
        editor.setValue(noteContent.trim());
      }
    }
  }

  private combine(frontmatter: NoteFrontmatter, content: string): string {
    return `---\n${this.obsidianService.stringifyYaml(frontmatter).trim()}\n---\n${content}`;
  }
}
