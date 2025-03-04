import { Editor, MarkdownFileInfo, MarkdownView, Plugin } from 'obsidian';
import { getIdFromUrl, getUrlFromId, HackMDClient } from './client';
import {
  IEditor,
  IFile,
  IObsidianService,
  ObsidianService,
} from './obsidian-service';
import { HackMDSettingTab } from './settings';
import { ModalFactory } from './modal';
import {
  DEFAULT_SETTINGS,
  HackMDError,
  HackMDErrorType,
  HackMDMetadata,
  HackMDNote,
  HackMDPluginSettings,
  NoteFrontmatter,
  SyncMode,
  SyncPrepareResult,
  UpdateLocalNoteParams,
} from './types';

export default class HackMDPlugin extends Plugin {
  private settings: HackMDPluginSettings;
  public getSettings(): HackMDPluginSettings {
    return this.settings;
  }

  public async updateSettings(value: Partial<HackMDPluginSettings>) {
    this.settings = {
      ...this.settings,
      ...value,
    };
    await this.saveData(this.settings);
    HackMDClient.resetInstance();
  }

  private readonly SYNC_TIME_MARGIN = 4000;
  private obsidianService: IObsidianService;

  async onload() {
    this.obsidianService = new ObsidianService(this.app);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.registerEditorCommands();
    this.registerCreateFromHackMDCommand();
    this.addSettingTab(new HackMDSettingTab(this.app, this));
  }

  private registerEditorCommands(): void {
    const commands = [
      {
        name: 'Push',
        callback: this.pushToHackMD.bind(this),
      },
      {
        name: 'Pull',
        callback: this.pullFromHackMD.bind(this),
      },
      {
        name: 'Force Push',
        callback: (editor: IEditor, file: IFile) =>
          this.pushToHackMD(editor, file, 'force'),
      },
      {
        name: 'Force Pull',
        callback: (editor: IEditor, file: IFile) =>
          this.pullFromHackMD(editor, file, 'force'),
      },
      {
        name: 'Copy URL',
        callback: this.copyHackMDUrl.bind(this),
      },
      {
        name: 'Delete Remote',
        callback: this.deleteHackMDNote.bind(this),
      },
    ];

    for (const command of commands) {
      this.addCommand({
        id: command.name.toLowerCase().replace(/ /g, '-'),
        name: command.name,
        editorCallback: this.createEditorCallback(command.callback),
      });
    }
  }

  private createEditorCallback<T extends (...args: any[]) => Promise<void>>(
    callback: T
  ) {
    return async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      try {
        if (!(ctx instanceof MarkdownView) || !ctx.file) {
          throw new HackMDError(HackMDErrorType.NO_ACTIVE_NOTE);
        }
        const editorAdapter = this.obsidianService.wrapObsidianEditor(editor);
        const fileAdapter = this.obsidianService.wrapObsidianFile(ctx.file);
        await callback(editorAdapter, fileAdapter);
      } catch (error) {
        this.handleCommandError(error);
      }
    };
  }

  private registerCreateFromHackMDCommand(): void {
    this.addCommand({
      id: 'create-note-from-hackmd-url',
      name: 'Create Note from HackMD URL',
      callback: this.createNonEditorCallback(() => this.promptAndCreateNote()),
    });
  }

  private createNonEditorCallback<T extends () => Promise<void>>(callback: T) {
    return async () => {
      try {
        await callback();
      } catch (error) {
        this.handleCommandError(error);
      }
    };
  }

  private handleCommandError(error: any): void {
    console.error('Command failed:', error);
    if (error instanceof HackMDError) {
      // Use the error message directly - it's already user-friendly
      this.obsidianService.notifyUser(error.message);
    } else {
      this.obsidianService.notifyUser(`Operation failed: ${error.message}`);
    }
  }

  private async getClient(): Promise<HackMDClient> {
    return HackMDClient.getInstance(
      this.settings.accessToken,
      this.obsidianService
    );
  }

  private async pushToHackMD(
    editor: IEditor,
    file: IFile,
    mode: SyncMode = 'normal'
  ): Promise<void> {
    const client = await this.getClient();
    const { content, noteId } = await this.prepareSync(editor);
    let result;

    if (noteId) {
      if (mode === 'normal') {
        await this.checkPushConflicts(file, noteId);
      }
      result = await client.updateNote(noteId, { content });
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
    const client = await this.getClient();
    const { frontmatter } = this.getFrontmatter(content);

    const newFrontmatter: NoteFrontmatter = {
      ...frontmatter,
      title: file.basename,
    };

    const contentWithTitle = this.combine(newFrontmatter, content);
    return client.createNote({
      content: contentWithTitle,
      readPermission: this.settings.readPermission,
      writePermission: this.settings.writePermission,
      commentPermission: this.settings.commentPermission,
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

  private async promptAndCreateNote(): Promise<void> {
    const url = await new Promise<string | null>(resolve => {
      ModalFactory.createUrlPromptModal(this.app, async value => {
        resolve(value);
      }).open();
    });

    if (url) {
      await this.createNoteFromHackMDUrl(url);
    }
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
    const client = await this.getClient();
    const noteData = await client.getNote(noteId);
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

  private async pullFromHackMD(
    editor: IEditor,
    file: IFile,
    mode: SyncMode = 'normal'
  ): Promise<void> {
    const client = await this.getClient();
    const { noteId } = await this.prepareSync(editor);

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
    }

    if (mode === 'normal') {
      await this.checkPullConflicts(file);
    }

    const note = await client.getNote(noteId);
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

  private async copyHackMDUrl(editor: IEditor): Promise<void> {
    const { noteId } = await this.prepareSync(editor);

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
    }
    const url = getUrlFromId(noteId);
    await this.obsidianService.copyToClipboard(url);
    this.obsidianService.notifyUser('HackMD URL copied to clipboard!');
  }

  private async deleteHackMDNote(editor: IEditor, file: IFile): Promise<void> {
    const client = await this.getClient();
    const { frontmatter } = await this.prepareSync(editor);
    const noteId = frontmatter?.url ? getIdFromUrl(frontmatter.url) : undefined;

    if (!noteId) {
      throw new HackMDError(HackMDErrorType.SYNC_NOT_LINKED);
    }

    const modal = ModalFactory.createDeleteModal(
      this.app,
      file.basename,
      async () => {
        await client.deleteNote(noteId);
        await this.cleanupHackMDMetadata(editor);
        this.obsidianService.notifyUser(
          'Successfully unlinked note from HackMD!'
        );
      }
    );

    modal.open();
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
    const client = await this.getClient();
    const note = await client.getNote(noteId);
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

    if (lastSyncTime - remoteModTime > this.SYNC_TIME_MARGIN) {
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

    if (localModTime - lastSyncTime > this.SYNC_TIME_MARGIN) {
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
    await this.saveData(this.settings);
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
