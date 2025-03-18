import { Editor, MarkdownFileInfo, MarkdownView, Plugin } from 'obsidian';
import { HackMDClient } from './client';
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
  HackMDPluginSettings,
} from './types';
import { Commands } from './commands';

export default class HackMDPlugin extends Plugin {
  private settings: HackMDPluginSettings;
  private obsidianService: IObsidianService;
  private commands: Commands;
  private hackMDClient: HackMDClient;

  public getSettings(): HackMDPluginSettings {
    return this.settings;
  }

  public async updateSettings(
    value: Partial<HackMDPluginSettings>
  ): Promise<void> {
    this.settings = {
      ...this.settings,
      ...value,
    };
    await this.saveData(this.settings);
    this.hackMDClient.updateSettings(this.settings);

    // Validate auth if the token was updated
    if ('accessToken' in value) {
      try {
        await this.hackMDClient.validateAuth();
      } catch (error) {
        // Error handling is already implemented in the client
        console.error('Failed to validate auth after updating token:', error);
      }
    }
  }

  async onload() {
    this.obsidianService = new ObsidianService(this.app);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.hackMDClient = new HackMDClient(this.settings, this.obsidianService);
    this.commands = new Commands(this.obsidianService, this.hackMDClient);
    this.registerEditorCommands();
    this.registerCreateFromHackMDCommand();
    this.addSettingTab(new HackMDSettingTab(this.app, this));
  }

  private registerEditorCommands(): void {
    const editorCommands = [
      {
        name: 'Push',
        callback: this.commands.pushToHackMD.bind(this.commands),
      },
      {
        name: 'Pull',
        callback: this.commands.pullFromHackMD.bind(this.commands),
      },
      {
        name: 'Force Push',
        callback: (editor: IEditor, file: IFile) =>
          this.commands.pushToHackMD(editor, file, 'force'),
      },
      {
        name: 'Force Pull',
        callback: (editor: IEditor, file: IFile) =>
          this.commands.pullFromHackMD(editor, file, 'force'),
      },
      {
        name: 'Copy URL',
        callback: this.commands.copyHackMDUrl.bind(this.commands),
      },
      {
        name: 'Delete Remote',
        callback: this.deleteHackMDNote.bind(this),
      },
    ];

    for (const command of editorCommands) {
      this.addCommand({
        id: command.name.toLowerCase().replace(/ /g, '-'),
        name: command.name,
        editorCallback: this.createEditorCallback(command.callback),
      });
    }
  }

  private createEditorCallback<
    T extends (
      editor: IEditor,
      file: IFile,
      ...rest: unknown[]
    ) => Promise<void>,
  >(callback: T) {
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

  public async promptAndCreateNote(): Promise<void> {
    const url = await new Promise<string | null>(resolve => {
      ModalFactory.createUrlPromptModal(this.app, async value => {
        resolve(value);
      }).open();
    });

    if (url) {
      await this.commands.createNoteFromHackMDUrl(url);
    }
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

  private handleCommandError(error: Error | HackMDError | unknown): void {
    console.error('Command failed:', error);
    if (error instanceof HackMDError) {
      // Use the error message directly - it's already user-friendly
      this.obsidianService.notifyUser(error.message);
    } else if (error instanceof Error) {
      this.obsidianService.notifyUser(`Operation failed: ${error.message}`);
    } else {
      this.obsidianService.notifyUser(
        'Operation failed due to an unknown error'
      );
    }
  }

  private async deleteHackMDNote(editor: IEditor, file: IFile): Promise<void> {
    const modal = ModalFactory.createDeleteModal(
      this.app,
      file.basename,
      this.commands.delete(editor).bind(this.commands)
    );
    modal.open();
  }
}
