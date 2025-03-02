import {
  requestUrl,
  RequestUrlParam,
  RequestUrlResponsePromise,
  Editor,
  Notice,
  parseYaml,
  stringifyYaml,
  TFile,
  App,
} from 'obsidian';

/**
 * Abstraction for Obsidian's Editor
 */
export interface IEditor {
  getValue(): string;
  setValue(content: string): void;
}

export interface IFile {
  basename: string;
  path: string;
  mtime: number;
}

/**
 * Service to encapsulate Obsidian API calls
 * This service makes testing easier by providing a layer that can be mocked
 */
export interface IObsidianService {
  /**
   * Make a request to a URL using Obsidian's requestUrl
   * @param options Request options
   */
  requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise;

  wrapObsidianEditor(editor: Editor): IEditor;

  wrapObsidianFile(file: TFile): IFile;

  openFileInNewTab(file: IFile): void;

  readFile(file: IFile): Promise<string>;

  findFileByUrlProperty(url: string): IFile | null;

  createAndOpenFileWithUniqueFilename(
    title: string,
    content: string
  ): Promise<string>;

  copyToClipboard(text: string): Promise<void>;

  notifyUser(message: string): void;

  /**
   * Parse YAML string to object
   * @param yaml YAML string to parse
   */
  parseYaml(yaml: string): any;

  /**
   * Convert object to YAML string
   * @param object Object to convert to YAML
   */
  stringifyYaml(object: any): string;
}

/**
 * Implementation of the Obsidian service
 */
export class ObsidianService implements IObsidianService {
  constructor(private app: App) {}

  /**
   * Make a request to a URL using Obsidian's requestUrl
   * @param options Request options
   */
  public requestUrl(
    request: RequestUrlParam | string
  ): RequestUrlResponsePromise {
    return requestUrl(request);
  }

  public wrapObsidianEditor(editor: Editor): IEditor {
    return {
      getValue: () => editor.getValue(),
      setValue: (content: string) => editor.setValue(content),
    };
  }

  public wrapObsidianFile(file: TFile): IFile {
    return {
      basename: file.basename,
      path: file.path,
      mtime: file.stat.mtime,
    };
  }

  public openFileInNewTab(existingNote: IFile): void {
    const file = this.app.vault.getFileByPath(existingNote.path);
    if (file) {
      this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  public readFile(file: IFile): Promise<string> {
    const tfile = this.app.vault.getFileByPath(file.path);
    if (!tfile) {
      throw new Error(`File not found: ${file.path}`);
    }
    return this.app.vault.read(tfile);
  }

  public findFileByUrlProperty(url: string): IFile | null {
    const files = this.app.vault.getMarkdownFiles();
    const found = files.find(file => {
      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter?.url === url;
    });

    return found ? this.wrapObsidianFile(found) : null;
  }

  public async createAndOpenFileWithUniqueFilename(
    title: string,
    content: string
  ): Promise<string> {
    const fileName = this.generateUniqueFileName(title);
    const file = await this.app.vault.create(fileName, content);
    this.app.workspace.getLeaf(true).openFile(file);
    return fileName;
  }

  /**
   * Generates a unique filename to avoid conflicts
   * @param baseTitle The original title to use as a base
   * @returns A unique filename that doesn't exist in the vault
   */
  private generateUniqueFileName(baseTitle: string): string {
    let fileName = `${baseTitle}.md`;
    let filePath = this.app.vault.getAbstractFileByPath(fileName)?.path;
    let counter = 1;

    while (filePath) {
      fileName = `${baseTitle} (${counter}).md`;
      filePath = this.app.vault.getAbstractFileByPath(fileName)?.path;
      counter++;
    }

    return fileName;
  }

  public copyToClipboard(message: string): Promise<void> {
    return navigator.clipboard.writeText(message);
  }

  public notifyUser(message: string): void {
    new Notice(message);
  }

  /**
   * Parse YAML string to object
   * @param yaml YAML string to parse
   */
  public parseYaml(yaml: string): any {
    return parseYaml(yaml);
  }

  /**
   * Convert object to YAML string
   * @param object Object to convert to YAML
   */
  public stringifyYaml(object: any): string {
    return stringifyYaml(object);
  }
}
