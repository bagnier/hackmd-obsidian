import { App, DropdownComponent, PluginSettingTab, Setting } from 'obsidian';
import type HackMDPlugin from './main';
import { CommentPermissionType, NotePermissionRole } from './types';

export class HackMDSettingTab extends PluginSettingTab {
  private readonly plugin: HackMDPlugin;

  constructor(app: App, plugin: HackMDPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(this.containerEl)
      .setName('Token')
      .setDesc(
        'HackMD API access token (from hackmd.io → Settings → API → Create API token)'
      )
      .addText(text =>
        text
          .setPlaceholder('Enter your HackMD access token')
          .setValue(this.plugin.getSettings().accessToken || '')
          .onChange(async accessToken => {
            await this.plugin.updateSettings({ accessToken });
          })
      );

    new Setting(this.containerEl)
      .setName('Read permission')
      .setDesc('Read permission for new notes')
      .addDropdown(dropdown =>
        this.configurePermissionDropdown(
          dropdown,
          NotePermissionRole,
          this.plugin.getSettings().readPermission,
          async (readPermission: NotePermissionRole) => {
            await this.plugin.updateSettings({ readPermission });
          }
        )
      );

    new Setting(this.containerEl)
      .setName('Write permission')
      .setDesc('Write permission for new notes')
      .addDropdown(dropdown =>
        this.configurePermissionDropdown(
          dropdown,
          NotePermissionRole,
          this.plugin.getSettings().writePermission,
          async (writePermission: NotePermissionRole) => {
            await this.plugin.updateSettings({ writePermission });
          }
        )
      );

    new Setting(this.containerEl)
      .setName('Comment permission')
      .setDesc('Comment permission for new notes')
      .addDropdown(dropdown =>
        this.configurePermissionDropdown(
          dropdown,
          CommentPermissionType,
          this.plugin.getSettings().commentPermission,
          async (commentPermission: CommentPermissionType) => {
            await this.plugin.updateSettings({ commentPermission });
          }
        )
      );
  }

  /**
   * Configures a dropdown component with options from a TypeScript enum.
   *
   * @param dropdown - The Obsidian DropdownComponent to configure
   * @param enumObj - The enum object (e.g., NotePermissionRole or CommentPermissionType)
   * @param currentValue - The currently selected enum value to pre-select in the dropdown
   * @param onChange - Callback function that receives the new value when selection changes
   * @returns The configured dropdown component for method chaining
   */
  private configurePermissionDropdown<T extends string>(
    dropdown: DropdownComponent,
    enumObj: Record<string, string>,
    currentValue: T,
    onChange: (value: T) => Promise<void>
  ): DropdownComponent {
    Object.entries(enumObj)
      // Filter out reverse mappings that TypeScript creates for string enums
      // In a string enum, TypeScript might create reversed entries like:
      // { OWNER: 'Owner only', 'Owner only': 'OWNER' }
      // We only want the OWNER -> 'Owner only' mappings, not the reverse ones
      .forEach(([key, value]) => {
        // For each enum entry, add an option to the dropdown where:
        // - key (e.g., 'OWNER') becomes the internal value stored in settings
        // - value (e.g., 'Owner only') becomes the display text shown to the user
        dropdown.addOption(key, value);
      });

    // Set the current value and wire up the change handler
    // This makes the dropdown show the current setting and updates it when changed
    return dropdown.setValue(currentValue).onChange(onChange);
  }
}
