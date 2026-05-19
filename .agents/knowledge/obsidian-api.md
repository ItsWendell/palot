---
title: Obsidian API Reference
description: Complete reference for the Obsidian plugin API — Plugin class, Workspace, Vault, Editor, UI components, and utility functions.
source: npm:obsidian
tags: obsidian, plugin, api, typescript
agents: architect, builder, reviewer
updated: 2026-05-15
---

# Obsidian API Reference

Reference for the Obsidian plugin API, auto-generated from the `obsidian` npm package v1.12.3. Covers the key API surfaces for plugin development.

Use this reference when implementing Obsidian plugins. Focus on the `Plugin` class, `Workspace`, `Vault`, `Editor`, and UI components.

---

## Plugin Lifecycle

###  `Component`

> /** @public @since 0.9.7
```typescript
export class Component
```

_/** Load this component and its children @public @since 0.9.7_
- `load(): void`
_/** Override this to load your component @public @virtual @since 0.9.7_
- `onload(): void`
_/** Unload this component and its children @public @since 0.9.7_
- `unload(): void`
_/** Override this to unload your component @public @virtual @since 0.9.7_
- `onunload(): void`
_/** Registers a callback to be called when unloading @public @since 0.9.7_
- `register(cb: () => any): void`
_/** Registers an event to be detached when unloading @public @since 0.9.7_
- `registerEvent(eventRef: EventRef): void`
_/** Registers an interval (from setInterval) to be cancelled when unloading Use {@link window.setInterval} instead of {@link setInterval} to avoid TypeScript confusing between NodeJS vs Browser API @public @since 0.13.8_
- `registerInterval(id: number): number`

###  `Plugin`

> /** @public @since 0.9.7
```typescript
export abstract class Pluginextends Component
```

_/** @public @since 0.9.7_
- `onload(): Promise<void> | void`
_/** Adds a ribbon icon to the left bar. @param icon - The icon name to be used. See {@link addIcon} @param title - The title to be displayed in the tooltip. @param callback - The `click` callback. @public @since 0.9.7_
- `addRibbonIcon(icon: IconName, title: string, callback: (evt: MouseEvent) => any): HTMLElement`
_/** Adds a status bar item to the bottom of the app. Not available on mobile. @see {@link https://docs.obsidian.md/Plugins/User+interface/Status+bar} @return HTMLElement - element to modify. @public @since 0.9.7_
- `addStatusBarItem(): HTMLElement`
_/** Register a command globally. Registered commands will be available from the {@link https://help.obsidian.md/Plugins/Command+palette Command palette}. The command id and name will be automatically prefixed with this plugin's id and name. @public @since 0.9.7_
- `addCommand(command: Command): Command`
_/** Manually remove a command from the list of global commands. This should not be needed unless your plugin registers commands dynamically. @public @since 1.7.2_
- `removeCommand(commandId: string): void`
_/** Register a settings tab, which allows users to change settings. @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings#Register+a+settings+tab} @public @since 0.9.7_
- `addSettingTab(settingTab: PluginSettingTab): void`
_/** @public @since 0.9.7_
- `registerView(type: string, viewCreator: ViewCreator): void`
_/** Registers a view with the 'Page preview' core plugin as an emitter of the 'hover-link' event. @public @since 1.1.0_
- `registerHoverLinkSource(id: string, info: HoverLinkSource): void`
_/** @public @since 0.9.7_
- `registerExtensions(extensions: string[], viewType: string): void`
_/** Registers a post processor, to change how the document looks in reading mode. @see {@link https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing} @public @since 0.9.7_
- `registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor`
_/** Register a special post processor that handles fenced code given a language and a handler. This special post processor takes care of removing the `<pre><code>` and create a `<div>` that will be passed to the handler, and is expected to be filled with custom elements. @see {@link https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing#Post-process+Markdown+code+blocks} @public @since 0.9.7_
- `registerMarkdownCodeBlockProcessor(language: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void, sortOrder?: number): MarkdownPostProcessor`
_/** Register a Base view handler that can be used to render data from property queries. @returns false if bases are not enabled in this vault. @public @since 1.10.0_
- `registerBasesView(viewId: string, registration: BasesViewRegistration): boolean`
_/** Registers a CodeMirror 6 extension. To reconfigure cm6 extensions for a plugin on the fly, an array should be passed in, and modified dynamically. Once this array is modified, calling {@link Workspace.updateOptions} will apply the changes. @param extension - must be a CodeMirror 6 `Extension`, or an array of Extensions. @public @since 0.12.8_
- `registerEditorExtension(extension: Extension): void`
_/** Register a handler for obsidian:// URLs. @param action - the action string. For example, 'open' corresponds to `obsidian://open`. @param handler - the callback to trigger. A key-value pair that is decoded from the query will be passed in. For example, `obsidian://open?key=value` would generate `{'action': 'open', 'key': 'value'}`. @public @since 0.11.0_
- `registerObsidianProtocolHandler(action: string, handler: ObsidianProtocolHandler): void`
_/** Register an EditorSuggest which can provide live suggestions while the user is typing. @public @since 0.12.7_
- `registerEditorSuggest(editorSuggest: EditorSuggest<any>): void`
_/** Register a CLI handler to handle a command from the CLI. Command IDs must be globally unique. Attempting to register a command that is already registered will throw an Error. Use the format `<plugin-id>` for your default command, and `<plugin-id>:<action>` for sub-commands and actions. @param command The command ID that will be used. Use alphanumeric characters without spaces. @param description The description text to provide in the help command, and in auto-completion prompts. @param flags Command line flags that can be passed in. @param handler The callback handler to handle a CLI invocation. @public @since 1.12.2_
- `registerCliHandler(command: string, description: string, flags: CliFlags | null, handler: CliHandler): void`
_/** Load settings data from disk. Data is stored in `data.json` in the plugin folder. @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings} @public @since 0.9.7_
- `loadData(): Promise<any>`
_/** Write settings data to disk. Data is stored in `data.json` in the plugin folder. @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings} @public @since 0.9.7_
- `saveData(data: any): Promise<void>`
_/** Perform any initial setup code. The user has explicitly interacted with the plugin so its safe to engage with the user. If your plugin registers a custom view, you can open it here. @public @since 1.7.2_
- `onUserEnable(): void`

###  `PluginManifest`

> /** Metadata about a Community plugin. @see {@link https://docs.obsidian.md/Reference/Manifest} @public
```typescript
export interface PluginManifest
```

###  `PluginSettingTab`

> /** Provides a unified interface for users to configure the plugin. @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings#Register+a+settings+tab} @public @since 0.9.7
```typescript
export abstract class PluginSettingTabextends SettingTab
```

###  `SettingTab`

> /** @public @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings#Register+a+settings+tab} @since 0.9.7
```typescript
export abstract class SettingTab
```

_/** Called when the settings tab should be rendered. @see {@link https://docs.obsidian.md/Plugins/User+interface/Settings#Register+a+settings+tab} @public_
- `display(): void`
_/** Hides the contents of the setting tab. Any registered components should be unloaded when the view is hidden. Override this if you need to perform additional cleanup. @public_
- `hide(): void`

---

## Workspace API

###  `Workspace`

> /** @public @since 0.9.7
```typescript
export class Workspaceextends Events
```

_/** Runs the callback function right away if layout is already ready, or push it to a queue to be called later when layout is ready. @public @since 0.11.0_
- `onLayoutReady(callback: () => any): void`
_/** @public @since 0.9.7_
- `changeLayout(workspace: any): Promise<void>`
_/** @public @since 0.9.7_
- `getLayout(): Record<string, unknown>`
_/** @public @since 0.9.11_
- `createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf`
_/** @public @since 0.9.7_
- `createLeafBySplit(leaf: WorkspaceLeaf, direction?: SplitDirection, before?: boolean): WorkspaceLeaf`
_/** @public @deprecated - You should use {@link Workspace.getLeaf|getLeaf(true)} instead which does the same thing. @since 0.9.7_
- `splitActiveLeaf(direction?: SplitDirection): WorkspaceLeaf`
_/** @public @deprecated - Use the new form of this method instead @since 0.13.8_
- `duplicateLeaf(leaf: WorkspaceLeaf, direction?: SplitDirection): Promise<WorkspaceLeaf>`
_/** @public @since 1.1.0_
- `duplicateLeaf(leaf: WorkspaceLeaf, leafType: PaneType | boolean, direction?: SplitDirection): Promise<WorkspaceLeaf>`
_/** @public @deprecated - You should use {@link Workspace.getLeaf|getLeaf(false)} instead which does the same thing._
- `getUnpinnedLeaf(): WorkspaceLeaf`
_/** Creates a new leaf in a leaf adjacent to the currently active leaf. If direction is `'vertical'`, the leaf will appear to the right. If direction is `'horizontal'`, the leaf will appear below the current leaf. @public @since 0.16.0_
- `getLeaf(newLeaf?: 'split', direction?: SplitDirection): WorkspaceLeaf`
_/** If newLeaf is false (or not set) then an existing leaf which can be navigated is returned, or a new leaf will be created if there was no leaf available. If newLeaf is `'tab'` or `true` then a new leaf will be created in the preferred location within the root split and returned. If newLeaf is `'split'` then a new leaf will be created adjacent to the currently active leaf. If newLeaf is `'window'` then a popout window will be created with a new leaf inside. @public @since 0.16.0_
- `getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf`
_/** Migrates this leaf to a new popout window. Only works on the desktop app. @public @throws Error if the app does not support popout windows (i.e. on mobile or if Electron version is too old) @since 0.15.4_
- `moveLeafToPopout(leaf: WorkspaceLeaf, data?: WorkspaceWindowInitData): WorkspaceWindow`
_/** Open a new popout window with a single new leaf and return that leaf. Only works on the desktop app. @public @since 0.15.4_
- `openPopoutLeaf(data?: WorkspaceWindowInitData): WorkspaceLeaf`
_/** @public @since 0.16.0_
- `openLinkText(linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: OpenViewState): Promise<void>`
_/** Sets the active leaf @param leaf - The new active leaf @param params - Parameter object of whether to set the focus. @public @since 0.16.3_
- `setActiveLeaf(leaf: WorkspaceLeaf, params?: {`
_/** @public */ focus?: boolean; }): void; /** @deprecated - function signature changed. Use other form instead @public_
- `setActiveLeaf(leaf: WorkspaceLeaf, pushHistory: boolean, focus: boolean): void`
_/** Retrieve a leaf by its id. @param id id of the leaf to retrieve. @public @since 1.5.1_
- `getLeafById(id: string): WorkspaceLeaf | null`
_/** Get all leaves that belong to a group @param group id @public @since 0.9.7_
- `getGroupLeaves(group: string): WorkspaceLeaf[]`
_/** Get the most recently active leaf in a given workspace root. Useful for interacting with the leaf in the root split while a sidebar leaf might be active. @param root Root for the leaves you want to search. If a root is not provided, the `rootSplit` and leaves within pop-outs will be searched. @public @since 0.15.4_
- `getMostRecentLeaf(root?: WorkspaceParent): WorkspaceLeaf | null`
_/** Create a new leaf inside the left sidebar. @param split Should the existing split be split up? @public @since 0.9.7_
- `getLeftLeaf(split: boolean): WorkspaceLeaf | null`
_/** Create a new leaf inside the right sidebar. @param split Should the existing split be split up? @public @since 0.9.7_
- `getRightLeaf(split: boolean): WorkspaceLeaf | null`
_/** Get side leaf or create one if one does not exist. @public @since 1.7.2_
- `ensureSideLeaf(type: string, side: Side, options?: {`
_/** Returns the file for the current view if it's a `FileView`. Otherwise, it will return the most recently active file. @public_
- `getActiveFile(): TFile | null`
_/** Iterate through all leaves in the main area of the workspace. @public @since 0.9.7_
- `iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void`
_/** Iterate through all leaves, including main area leaves, floating leaves, and sidebar leaves. @public @since 0.9.7_
- `iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void`
_/** Get all leaves of a given type. @public @since 0.9.7_
- `getLeavesOfType(viewType: string): WorkspaceLeaf[]`
_/** Remove all leaves of the given type. @public @since 0.9.7_
- `detachLeavesOfType(viewType: string): void`
_/** Bring a given leaf to the foreground. If the leaf is in a sidebar, the sidebar will be uncollapsed. `await` this function to ensure your view has been fully loaded and is not deferred. @public @since 1.7.2_
- `revealLeaf(leaf: WorkspaceLeaf): Promise<void>`
_/** Get the filenames of the 10 most recently opened files. @public @since 0.9.7_
- `getLastOpenFiles(): string[]`
_/** Calling this function will update/reconfigure the options of all Markdown views. It is fairly expensive, so it should not be called frequently. @public @since 0.13.21_
- `updateOptions(): void`
- _... and 17 more methods_

###  `WorkspaceContainer`

> /** @public @since 0.15.4
```typescript
export abstract class WorkspaceContainerextends WorkspaceSplit
```

###  `WorkspaceFloating`

> /** @public @since 0.15.2
```typescript
export class WorkspaceFloatingextends WorkspaceParent
```

###  `WorkspaceItem`

> /** @public @since 0.10.2
```typescript
export abstract class WorkspaceItemextends Events
```

_/** @public @since 0.10.2_
- `getRoot(): WorkspaceItem`
_/** Get the root container parent item, which can be one of: - {@link WorkspaceRoot} - {@link WorkspaceWindow} @public @since 0.15.4_
- `getContainer(): WorkspaceContainer`

###  `WorkspaceLeaf`

> /** @public
```typescript
export class WorkspaceLeafextends WorkspaceItem implements HoverParent
```

_/** @public */ hoverPopover: HoverPopover | null; /** Open a file in this leaf. @public_
- `openFile(file: TFile, openState?: OpenViewState): Promise<void>`
_/** @public_
- `open(view: View): Promise<View>`
_/** @public_
- `getViewState(): ViewState`
_/** @public_
- `setViewState(viewState: ViewState, eState?: any): Promise<void>`
_/** Returns true if this leaf is currently deferred because it is in the background. A deferred leaf will have a DeferredView as its view, instead of the View that it should normally have for its type (like MarkdownView for the `markdown` type). @since 1.7.2 @public_
- `isDeferred(): boolean`
_/** If this view is currently deferred, load it and await that it has fully loaded. @since 1.7.2 @public_
- `loadIfDeferred(): Promise<void>`
_/** @public_
- `getEphemeralState(): any`
_/** @public_
- `setEphemeralState(state: any): void`
_/** @public_
- `togglePinned(): void`
_/** @public_
- `setPinned(pinned: boolean): void`
_/** @public_
- `setGroupMember(other: WorkspaceLeaf): void`
_/** @public_
- `setGroup(group: string): void`
_/** @public_
- `detach(): void`
_/** @public_
- `getIcon(): IconName`
_/** @public_
- `getDisplayText(): string`
_/** @public_
- `onResize(): void`
_/** @public_
- `on(name: 'pinned-change', callback: (pinned: boolean) => any, ctx?: any): EventRef`
_/** @public_
- `on(name: 'group-change', callback: (group: string) => any, ctx?: any): EventRef`

###  `WorkspaceMobileDrawer`

> /** @public @since 1.6.6
```typescript
export class WorkspaceMobileDrawerextends WorkspaceParent
```

_/** @public */ expand(): void; /** @public */_
- `collapse(): void`

###  `WorkspaceParent`

> /** @public @since 0.9.7
```typescript
export abstract class WorkspaceParentextends WorkspaceItem
```

###  `WorkspaceRoot`

> /** @public @since 0.15.2
```typescript
export class WorkspaceRootextends WorkspaceContainer
```

###  `WorkspaceSidedock`

> /** @public @since 0.15.4
```typescript
export class WorkspaceSidedockextends WorkspaceSplit
```

_/** @public @since 0.12.11_
- `toggle(): void`
_/** @public @since 0.12.11_
- `collapse(): void`
_/** @public @since 0.12.11_
- `expand(): void`

###  `WorkspaceSplit`

> /** @public @since 0.9.7
```typescript
export class WorkspaceSplitextends WorkspaceParent
```

###  `WorkspaceTabs`

> /** @public
```typescript
export class WorkspaceTabsextends WorkspaceParent
```

###  `WorkspaceWindow`

> /** @public @since 0.15.4
```typescript
export class WorkspaceWindowextends WorkspaceContainer
```

---

## Editor API

###  `Editor`

> /** A common interface that bridges the gap between CodeMirror 5 and CodeMirror 6. @public @since 0.11.11
```typescript
export abstract class Editor
```

_/** @public @since 0.11.11_
- `getDoc(): this`
_/** @public @since 0.11.11_
- `refresh(): void`
_/** @public @since 0.11.11_
- `getValue(): string`
_/** @public @since 0.11.11_
- `setValue(content: string): void`
_/** Get the text at line (0-indexed) @public @since 0.11.11_
- `getLine(line: number): string`
_/** @public @since 0.11.11_
- `setLine(n: number, text: string): void`
_/** Gets the number of lines in the document @public @since 0.11.11_
- `lineCount(): number`
_/** @public @since 0.11.11_
- `lastLine(): number`
_/** @public @since 0.11.11_
- `getSelection(): string`
_/** @public @since 0.11.11_
- `somethingSelected(): boolean`
_/** @public @since 0.11.11_
- `getRange(from: EditorPosition, to: EditorPosition): string`
_/** @public @since 0.11.11_
- `replaceSelection(replacement: string, origin?: string): void`
_/** @public @since 0.11.11_
- `replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition, origin?: string): void`
_/** @public @since 0.11.11_
- `getCursor(side?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition`
_/** @public @since 0.11.11_
- `listSelections(): EditorSelection[]`
_/** @public @since 0.11.11_
- `setCursor(pos: EditorPosition | number, ch?: number): void`
_/** @public @since 0.11.11_
- `setSelection(anchor: EditorPosition, head?: EditorPosition): void`
_/** @public @since 0.12.11_
- `setSelections(ranges: EditorSelectionOrCaret[], main?: number): void`
_/** @public @since 0.11.11_
- `focus(): void`
_/** @public @since 0.11.11_
- `blur(): void`
_/** @public @since 0.11.11_
- `hasFocus(): boolean`
_/** @public @since 0.11.11_
- `getScrollInfo(): {`
_/** @public @since 0.11.11_
- `scrollTo(x?: number | null, y?: number | null): void`
_/** @public @since 0.13.0_
- `scrollIntoView(range: EditorRange, center?: boolean): void`
_/** @public @since 0.11.11_
- `undo(): void`
_/** @public @since 0.11.11_
- `redo(): void`
_/** @public @since 0.12.2_
- `exec(command: EditorCommandName): void`
_/** @public @since 0.13.0_
- `transaction(tx: EditorTransaction, origin?: string): void`
_/** @public @since 0.11.11_
- `wordAt(pos: EditorPosition): EditorRange | null`
_/** @public @since 0.11.11_
- `posToOffset(pos: EditorPosition): number`
- _... and 1 more methods_

###  `EditorPosition`

> /** @public @since 0.12.11
```typescript
export interface EditorPosition
```

###  `EditorRange`

> /** @public @since 0.12.11
```typescript
export interface EditorRange
```

###  `EditorScrollInfo`

> /** @public @since 0.15.0
```typescript
export interface EditorScrollInfo
```

###  `EditorSelection`

> /** @public @since 0.12.11
```typescript
export interface EditorSelection
```

###  `MarkdownEditView`

> /** This is the editor for Obsidian Mobile as well as the WYSIWYG editor. @public
```typescript
export class MarkdownEditViewimplements MarkdownSubView, HoverParent, MarkdownFileInfo
```

_/** @public_
- `clear(): void`
_/** @public_
- `get(): string`
_/** @public_
- `set(data: string, clear: boolean): void`
_/** @public */ get file(): TFile; /** @public_
- `getSelection(): string`
_/** @public_
- `getScroll(): number`
_/** @public_
- `applyScroll(scroll: number): void`

###  `MarkdownFileInfo`

> /** @public
```typescript
export interface MarkdownFileInfoextends HoverParent
```

_/** @public_
- `file(): TFile | null`

###  `MarkdownPreviewView`

> /** @public
```typescript
export class MarkdownPreviewViewextends MarkdownRenderer implements MarkdownSubView, MarkdownPreviewEvents
```

_/** @public_
- `file(): TFile`
_/** @public_
- `get(): string`
_/** @public_
- `set(data: string, clear: boolean): void`
_/** @public_
- `clear(): void`
_/** @public_
- `rerender(full?: boolean): void`
_/** @public_
- `getScroll(): number`
_/** @public_
- `applyScroll(scroll: number): void`

###  `MarkdownSubView`

> /** @public
```typescript
export interface MarkdownSubView
```

_/** @public_
- `getScroll(): number`
_/** @public_
- `applyScroll(scroll: number): void`
_/** @public_
- `get(): string`
_/** @public_
- `set(data: string, clear: boolean): void`

###  `MarkdownView`

> /** @public
```typescript
export class MarkdownViewextends TextFileView implements MarkdownFileInfo
```

_/** @public_
- `getViewType(): string`
_/** @public_
- `getMode(): MarkdownViewModeType`
_/** @public_
- `getViewData(): string`
_/** @public_
- `clear(): void`
_/** @public_
- `setViewData(data: string, clear: boolean): void`
_/** @public_
- `showSearch(replace?: boolean): void`

---

## Vault & File System

###  `CachedMetadata`

> /** @public
```typescript
export interface CachedMetadata
```

###  `CapacitorAdapter`

> /** Implementation of the vault adapter for mobile devices. @public @since 1.7.2
```typescript
export class CapacitorAdapterimplements DataAdapter
```

_/** @public @since 1.7.2_
- `getName(): string`
_/** @public @since 1.7.2_
- `mkdir(normalizedPath: string): Promise<void>`
_/** @public @since 1.7.2_
- `trashSystem(normalizedPath: string): Promise<boolean>`
_/** @public @since 1.7.2_
- `trashLocal(normalizedPath: string): Promise<void>`
_/** @public @since 1.7.2_
- `rmdir(normalizedPath: string, recursive: boolean): Promise<void>`
_/** @public @since 1.7.2_
- `read(normalizedPath: string): Promise<string>`
_/** @public @since 1.7.2_
- `readBinary(normalizedPath: string): Promise<ArrayBuffer>`
_/** @public @since 1.7.2_
- `write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** @public @since 1.7.2_
- `writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** @public @since 1.7.2_
- `append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** @public @since 1.12.3_
- `appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** @public @since 1.7.2_
- `process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>`
_/** @public @since 1.7.2_
- `getResourcePath(normalizedPath: string): string`
_/** @public @since 1.7.2_
- `remove(normalizedPath: string): Promise<void>`
_/** @public @since 1.7.2_
- `rename(normalizedPath: string, normalizedNewPath: string): Promise<void>`
_/** @public @since 1.7.2_
- `copy(normalizedPath: string, normalizedNewPath: string): Promise<void>`
_/** @public @since 1.7.2_
- `exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>`
_/** @public @since 1.7.2_
- `stat(normalizedPath: string): Promise<Stat | null>`
_/** @public @since 1.7.2_
- `list(normalizedPath: string): Promise<ListedFiles>`
_/** @public @since 1.7.2_
- `getFullPath(normalizedPath: string): string`

###  `DataAdapter`

> /** @public */ export type Constructor<T> = abstract new (...args: any[]) => T; /** Work directly with files and folders inside a vault. If possible prefer using the {@link Vault} API over this. @public
```typescript
export interface DataAdapter
```

_/** @public_
- `getName(): string`
_/** Check if something exists at the given path. For a faster way to synchronously check if a note or attachment is in the vault, use {@link Vault.getAbstractFileByPath}. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @param sensitive - Some file systems/operating systems are case-insensitive, set to true to force a case-sensitivity check. @public_
- `exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>`
_/** Retrieve metadata about the given file/folder. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @public @since 0.12.2_
- `stat(normalizedPath: string): Promise<Stat | null>`
_/** Retrieve a list of all files and folders inside the given folder, non-recursive. @param normalizedPath - path to folder, use {@link normalizePath} to normalize beforehand. @public_
- `list(normalizedPath: string): Promise<ListedFiles>`
_/** @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @public_
- `read(normalizedPath: string): Promise<string>`
_/** @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @public_
- `readBinary(normalizedPath: string): Promise<ArrayBuffer>`
_/** Write to a plaintext file. If the file exists its content will be overwritten, otherwise the file will be created. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @param data - new file content @param options - (Optional) @public_
- `write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** Write to a binary file. If the file exists its content will be overwritten, otherwise the file will be created. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @param data - the new file content @param options - (Optional) @public_
- `writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** Add text to the end of a plaintext file. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @param data - the text to append. @param options - (Optional) @public_
- `append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** Add data to the end of a binary file. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @param data - the data to append. @param options - (Optional) @public @since 1.12.3_
- `appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** Atomically read, modify, and save the contents of a plaintext file. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @param fn - a callback function which returns the new content of the file synchronously. @param options - write options. @returns string - the text value of the file that was written. @public_
- `process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>`
_/** Returns a URI for the browser engine to use, for example to embed an image. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @public_
- `getResourcePath(normalizedPath: string): string`
_/** Create a directory. @param normalizedPath - path to use for new folder, use {@link normalizePath} to normalize beforehand. @public_
- `mkdir(normalizedPath: string): Promise<void>`
_/** Try moving to system trash. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @returns Returns true if succeeded. This can fail due to system trash being disabled. @public_
- `trashSystem(normalizedPath: string): Promise<boolean>`
_/** Move to local trash. Files will be moved into the `.trash` folder at the root of the vault. @param normalizedPath - path to file/folder, use {@link normalizePath} to normalize beforehand. @public_
- `trashLocal(normalizedPath: string): Promise<void>`
_/** Remove a directory. @param normalizedPath - path to folder, use {@link normalizePath} to normalize beforehand. @param recursive - If `true`, delete folders under this folder recursively, if `false` the folder needs to be empty. @public_
- `rmdir(normalizedPath: string, recursive: boolean): Promise<void>`
_/** Delete a file. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @public_
- `remove(normalizedPath: string): Promise<void>`
_/** Rename a file or folder. @param normalizedPath - current path to file/folder, use {@link normalizePath} to normalize beforehand. @param normalizedNewPath - new path to file/folder, use {@link normalizePath} to normalize beforehand. @public_
- `rename(normalizedPath: string, normalizedNewPath: string): Promise<void>`
_/** Create a copy of a file. This will fail if there is already a file at `normalizedNewPath`. @param normalizedPath - path to file, use {@link normalizePath} to normalize beforehand. @param normalizedNewPath - path to file, use {@link normalizePath} to normalize beforehand. @public_
- `copy(normalizedPath: string, normalizedNewPath: string): Promise<void>`

###  `FileManager`

> /** Manage the creation, deletion and renaming of files from the UI. @public @since 0.9.7
```typescript
export class FileManager
```

_/** Gets the folder that new files should be saved to, given the user's preferences. @param sourcePath - The path to the current open/focused file, used when the user wants new files to be created 'in the same folder'. Use an empty string if there is no active file. @param newFilePath - The path to the file that will be newly created, used to infer what settings to use based on the path's extension. @public @since 1.1.13_
- `getNewFileParent(sourcePath: string, newFilePath?: string): TFolder`
_/** Rename or move a file safely, and update all links to it depending on the user's preferences. @param file - the file to rename @param newPath - the new path for the file @public @since 0.11.0_
- `renameFile(file: TAbstractFile, newPath: string): Promise<void>`
_/** Prompt the user to confirm they want to delete the specified file or folder @param file - the file or folder to delete @returns A promise that resolves to true if the prompt was confirmed or false if it was canceled @public @since 0.15.0_
- `promptForDeletion(file: TAbstractFile): Promise<boolean>`
_/** Remove a file or a folder from the vault according the user's preferred 'trash' options (either moving the file to .trash/ or the OS trash bin). @param file @public @since 1.6.6_
- `trashFile(file: TAbstractFile): Promise<void>`
_/** Generate a Markdown link based on the user's preferences. @param file - the file to link to. @param sourcePath - where the link is stored in, used to compute relative links. @param subpath - A subpath, starting with `#`, used for linking to headings or blocks. @param alias - The display text if it's to be different than the file name. Pass empty string to use file name. @public @since 0.12.0_
- `generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string`
_/** Atomically read, modify, and save the frontmatter of a note. The frontmatter is passed in as a JS object, and should be mutated directly to achieve the desired result. Remember to handle errors thrown by this method. @param file - the file to be modified. Must be a Markdown file. @param fn - a callback function which mutates the frontmatter object synchronously. @param options - write options. @throws YAMLParseError if the YAML parsing fails @throws any errors that your callback function throws @example ```ts app.fileManager.processFrontMatter(file, (frontmatter) => { frontmatter['key1'] = value; delete frontmatter['key2']; }); ``` @public @since 1.4.4_
- `processFrontMatter(file: TFile, fn: (frontmatter: any) => void, options?: DataWriteOptions): Promise<void>`
_/** Resolves a unique path for the attachment file being saved. Ensures that the parent directory exists and dedupes the filename if the destination filename already exists. @param filename Name of the attachment being saved @param sourcePath The path to the note associated with this attachment, defaults to the workspace's active file. @returns Full path for where the attachment should be saved, according to the user's settings @public @since 1.5.7_
- `getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string>`

###  `FileStats`

> /** @public
```typescript
export interface FileStats
```

###  `FileSystemAdapter`

> /** Implementation of the vault adapter for desktop. @public
```typescript
export class FileSystemAdapterimplements DataAdapter
```

_/** @public_
- `getName(): string`
_/** @public_
- `getBasePath(): string`
_/** @public_
- `mkdir(normalizedPath: string): Promise<void>`
_/** @public_
- `trashSystem(normalizedPath: string): Promise<boolean>`
_/** @public_
- `trashLocal(normalizedPath: string): Promise<void>`
_/** @public_
- `rmdir(normalizedPath: string, recursive: boolean): Promise<void>`
_/** @public_
- `read(normalizedPath: string): Promise<string>`
_/** @public_
- `readBinary(normalizedPath: string): Promise<ArrayBuffer>`
_/** @public_
- `write(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** @public_
- `writeBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** @public_
- `append(normalizedPath: string, data: string, options?: DataWriteOptions): Promise<void>`
_/** @public @since 1.12.3_
- `appendBinary(normalizedPath: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** @public_
- `process(normalizedPath: string, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>`
_/** @public_
- `getResourcePath(normalizedPath: string): string`
_/** Returns the file:// path of this file @public @since 0.14.3_
- `getFilePath(normalizedPath: string): string`
_/** @public_
- `remove(normalizedPath: string): Promise<void>`
_/** @public_
- `rename(normalizedPath: string, normalizedNewPath: string): Promise<void>`
_/** @public_
- `copy(normalizedPath: string, normalizedNewPath: string): Promise<void>`
_/** @public_
- `exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>`
_/** @public @since 0.12.2_
- `stat(normalizedPath: string): Promise<Stat | null>`
_/** @public_
- `list(normalizedPath: string): Promise<ListedFiles>`
_/** @public_
- `getFullPath(normalizedPath: string): string`
_/** @public_
- `readLocalFile(path: string): Promise<ArrayBuffer>`
_/** @public_
- `mkdir(path: string): Promise<void>`

###  `FrontMatterCache`

> /** @public
```typescript
export interface FrontMatterCache
```

###  `ListedFiles`

> /** @public
```typescript
export interface ListedFiles
```

###  `MetadataCache`

> /** Linktext is any internal link that is composed of a path and a subpath, such as 'My note#Heading' Linkpath (or path) is the path part of a linktext Subpath is the heading/block ID part of a linktext. @public
```typescript
export class MetadataCacheextends Events
```

_/** Get the best match for a linkpath. @public @since 0.12.5_
- `getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null`
_/** @public @since 0.9.21_
- `getFileCache(file: TFile): CachedMetadata | null`
_/** @public @since 0.14.5_
- `getCache(path: string): CachedMetadata | null`
_/** Generates a linktext for a file. If file name is unique, use the filename. If not unique, use full path. @public_
- `fileToLinktext(file: TFile, sourcePath: string, omitMdExtension?: boolean): string`
_/** Called when a file has been indexed, and its (updated) cache is now available. Note: This is not called when a file is renamed for performance reasons. You must hook the vault rename event for those. @public_
- `on(name: 'changed', callback: (file: TFile, data: string, cache: CachedMetadata) => any, ctx?: any): EventRef`
_/** Called when a file has been deleted. A best-effort previous version of the cached metadata is presented, but it could be null in case the file was not successfully cached previously. @public_
- `on(name: 'deleted', callback: (file: TFile, prevCache: CachedMetadata | null) => any, ctx?: any): EventRef`
_/** Called when a file has been resolved for `resolvedLinks` and `unresolvedLinks`. This happens sometimes after a file has been indexed. @public_
- `on(name: 'resolve', callback: (file: TFile) => any, ctx?: any): EventRef`
_/** Called when all files has been resolved. This will be fired each time files get modified after the initial load. @public_
- `on(name: 'resolved', callback: () => any, ctx?: any): EventRef`

###  `TAbstractFile`

> /** This can be either a `TFile` or a `TFolder`. @public @since 0.9.7
```typescript
export abstract class TAbstractFile
```

###  `TFile`

> /** @public @since 0.9.7
```typescript
export class TFileextends TAbstractFile
```

###  `TFolder`

> /** @public @since 0.9.7
```typescript
export class TFolderextends TAbstractFile
```

_/** @public @since 0.9.7_
- `isRoot(): boolean`

###  `Vault`

> /** Work with files and folders stored inside a vault. @see {@link https://docs.obsidian.md/Plugins/Vault} @public @since 0.9.7
```typescript
export class Vaultextends Events
```

_/** Gets the name of the vault. @public @since 0.9.7_
- `getName(): string`
_/** Get a file inside the vault at the given path. Returns `null` if the file does not exist. @param path @public @since 1.5.7_
- `getFileByPath(path: string): TFile | null`
_/** Get a folder inside the vault at the given path. Returns `null` if the folder does not exist. @param path @public @since 1.5.7_
- `getFolderByPath(path: string): TFolder | null`
_/** Get a file or folder inside the vault at the given path. To check if the return type is a file, use `instanceof TFile`. To check if it is a folder, use `instanceof TFolder`. @param path - vault absolute path to the folder or file, with extension, case sensitive. @returns the abstract file, if it's found. @public @since 0.11.11_
- `getAbstractFileByPath(path: string): TAbstractFile | null`
_/** Get the root folder of the current vault. @public @since 0.9.7_
- `getRoot(): TFolder`
_/** Create a new plaintext file inside the vault. @param path - Vault absolute path for the new file, with extension. @param data - text content for the new file. @param options - (Optional) @public @since 0.9.7_
- `create(path: string, data: string, options?: DataWriteOptions): Promise<TFile>`
_/** Create a new binary file inside the vault. @param path - Vault absolute path for the new file, with extension. @param data - content for the new file. @param options - (Optional) @throws Error if file already exists @public @since 0.9.7_
- `createBinary(path: string, data: ArrayBuffer, options?: DataWriteOptions): Promise<TFile>`
_/** Create a new folder inside the vault. @param path - Vault absolute path for the new folder. @throws Error if folder already exists @public @since 1.4.0_
- `createFolder(path: string): Promise<TFolder>`
_/** Read a plaintext file that is stored inside the vault, directly from disk. Use this if you intend to modify the file content afterwards. Use {@link Vault.cachedRead} otherwise for better performance. @public @since 0.9.7_
- `read(file: TFile): Promise<string>`
_/** Read the content of a plaintext file stored inside the vault Use this if you only want to display the content to the user. If you want to modify the file content afterward use {@link Vault.read} @public @since 0.9.7_
- `cachedRead(file: TFile): Promise<string>`
_/** Read the content of a binary file stored inside the vault. @public @since 0.9.7_
- `readBinary(file: TFile): Promise<ArrayBuffer>`
_/** Returns a URI for the browser engine to use, for example to embed an image. @public @since 0.9.7_
- `getResourcePath(file: TFile): string`
_/** Deletes the file completely. @param file - The file or folder to be deleted @param force - Should attempt to delete folder even if it has hidden children @public @since 0.9.7_
- `delete(file: TAbstractFile, force?: boolean): Promise<void>`
_/** Tries to move to system trash. If that isn't successful/allowed, use local trash @param file - The file or folder to be deleted @param system - Set to `false` to use local trash by default. @public @since 0.9.7_
- `trash(file: TAbstractFile, system: boolean): Promise<void>`
_/** Rename or move a file. To ensure links are automatically renamed, use {@link FileManager.renameFile} instead. @param file - the file to rename/move @param newPath - vault absolute path to move file to. @public @since 0.9.11_
- `rename(file: TAbstractFile, newPath: string): Promise<void>`
_/** Modify the contents of a plaintext file. @param file - The file @param data - The new file content @param options - (Optional) @public @since 0.9.7_
- `modify(file: TFile, data: string, options?: DataWriteOptions): Promise<void>`
_/** Modify the contents of a binary file. @param file - The file @param data - The new file content @param options - (Optional) @public @since 0.9.7_
- `modifyBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** Add text to the end of a plaintext file inside the vault. @param file - The file @param data - the text to add @param options - (Optional) @public @since 0.13.0_
- `append(file: TFile, data: string, options?: DataWriteOptions): Promise<void>`
_/** Add data to the end of a binary file inside the vault. @param file - The file @param data - the data to add @param options - (Optional) @public @since 1.12.3_
- `appendBinary(file: TFile, data: ArrayBuffer, options?: DataWriteOptions): Promise<void>`
_/** Atomically read, modify, and save the contents of a note. @param file - the file to be read and modified. @param fn - a callback function which returns the new content of the note synchronously. @param options - write options. @returns string - the text value of the note that was written. @example ```ts app.vault.process(file, (data) => { return data.replace('Hello', 'World'); }); ``` @public @since 1.1.0_
- `process(file: TFile, fn: (data: string) => string, options?: DataWriteOptions): Promise<string>`
_/** Get all files and folders in the vault. @public @since 0.9.7_
- `getAllLoadedFiles(): TAbstractFile[]`
_/** Get all folders in the vault. @param includeRoot - Should the root folder (`/`) be returned @public @since 1.6.6_
- `getAllFolders(includeRoot?: boolean): TFolder[]`
_/** @public @since 0.9.7_
- `recurseChildren(root: TFolder, cb: (file: TAbstractFile) => any): void`
_/** Get all Markdown files in the vault. @public @since 0.9.7_
- `getMarkdownFiles(): TFile[]`
_/** Get all files in the vault. @public @since 0.9.7_
- `getFiles(): TFile[]`
_/** Called when a file is created. This is also called when the vault is first loaded for each existing file If you do not wish to receive create events on vault load, register your event handler inside {@link Workspace.onLayoutReady}. @public @since 0.9.7_
- `on(name: 'create', callback: (file: TAbstractFile) => any, ctx?: any): EventRef`
_/** Called when a file is modified. @public @since 0.9.7_
- `on(name: 'modify', callback: (file: TAbstractFile) => any, ctx?: any): EventRef`
_/** Called when a file is deleted. @public @since 0.9.7_
- `on(name: 'delete', callback: (file: TAbstractFile) => any, ctx?: any): EventRef`
_/** Called when a file is renamed. @public @since 0.9.7_
- `on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => any, ctx?: any): EventRef`

---

## Views

###  `EditableFileView`

> /** @public @since 0.9.7
```typescript
export abstract class EditableFileViewextends FileView
```

###  `FileView`

> /** @public
```typescript
export abstract class FileViewextends ItemView
```

_/** @public_
- `getDisplayText(): string`
_/** @public_
- `onload(): void`
_/** @public_
- `getState(): Record<string, unknown>`
_/** @public @since 0.9.7_
- `setState(state: any, result: ViewStateResult): Promise<void>`
_/** @public_
- `onLoadFile(file: TFile): Promise<void>`
_/** @public_
- `onUnloadFile(file: TFile): Promise<void>`
_/** @public_
- `onRename(file: TFile): Promise<void>`
_/** @public @since 0.9.7_
- `canAcceptExtension(extension: string): boolean`

###  `ItemView`

> /** @public @since 0.9.7
```typescript
export abstract class ItemViewextends View
```

_/** @public @since 1.1.0_
- `addAction(icon: IconName, title: string, callback: (evt: MouseEvent) => any): HTMLElement`

###  `TextFileView`

> /** This class implements a plaintext-based editable file view, which can be loaded and saved given an editor. Note that by default, this view only saves when it's closing. To implement auto-save, your editor should call `this.requestSave()` when the content is changed. @public @since 0.10.12
```typescript
export abstract class TextFileViewextends EditableFileView
```

_/** @public @since 0.10.12_
- `onUnloadFile(file: TFile): Promise<void>`
_/** @public @since 0.10.12_
- `onLoadFile(file: TFile): Promise<void>`
_/** @public @since 0.10.12_
- `save(clear?: boolean): Promise<void>`
_/** Gets the data from the editor. This will be called to save the editor contents to the file. @public @since 0.10.12_
- `getViewData(): string`
_/** Set the data to the editor. This is used to load the file contents. If clear is set, then it means we're opening a completely different file. In that case, you should call clear(), or implement a slightly more efficient clearing mechanism given the new data to be set. @public @since 0.10.12_
- `setViewData(data: string, clear: boolean): void`
_/** Clear the editor. This is usually called when we're about to open a completely different file, so it's best to clear any editor states like undo-redo history, and any caches/indexes associated with the previous file contents. @public @since 0.10.12_
- `clear(): void`

###  `View`

> /** @public @since 0.9.7
```typescript
export abstract class Viewextends Component
```

_/** @public @since 0.9.7_
- `onOpen(): Promise<void>`
_/** @public @since 0.9.7_
- `onClose(): Promise<void>`
_/** @public @since 0.9.7_
- `getViewType(): string`
_/** @public @since 0.9.7_
- `getState(): Record<string, unknown>`
_/** @public @since 0.9.7_
- `setState(state: unknown, result: ViewStateResult): Promise<void>`
_/** @public @since 0.9.7_
- `getEphemeralState(): Record<string, unknown>`
_/** @public @since 0.9.7_
- `setEphemeralState(state: unknown): void`
_/** @public @since 1.1.0_
- `getIcon(): IconName`
_/** Called when the size of this view is changed. @public @since 0.9.7_
- `onResize(): void`
_/** @public @since 0.9.7_
- `getDisplayText(): string`
_/** Populates the pane menu. (Replaces the previously removed `onHeaderMenu` and `onMoreOptionsMenu`) @public @since 0.15.3_
- `onPaneMenu(menu: Menu, source: 'more-options' | 'tab-header' | string): void`

###  `ViewCreator`

> /** @public
```typescript
export type ViewCreator = (leaf: WorkspaceLeaf) => View;
```

###  `ViewState`

> /** @public
```typescript
export interface ViewState
```

###  `ViewStateResult`

> /** @public
```typescript
export interface ViewStateResult
```

###  `WorkspaceRibbon`

> /** @public
```typescript
export class WorkspaceRibbon
```

---

## Commands & Keybindings

###  `Command`

> /** @public
```typescript
export interface Command
```

###  `Hotkey`

> /** @public */ export function hexToArrayBuffer(hex: string): ArrayBuffer; /** @public
```typescript
export interface Hotkey
```

###  `Keymap`

> /** Manages keymap lifecycle for different {@link Scope}s. @public @since 0.13.9
```typescript
export class Keymap
```

_/** Push a scope onto the scope stack, setting it as the active scope to handle all key events. @public @since 0.13.9_
- `pushScope(scope: Scope): void`
_/** Remove a scope from the scope stack. If the given scope is active, the next scope in the stack will be made active. @public @since 0.13.9_
- `popScope(scope: Scope): void`
_/** Checks whether the modifier key is pressed during this event. @public @since 0.12.17_
- `isModifier(evt: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean`
_/** Translates an event into the type of pane that should open. Returns 'tab' if the modifier key Cmd/Ctrl is pressed OR if this is a middle-click MouseEvent. Returns 'split' if Cmd/Ctrl+Alt is pressed. Returns 'window' if Cmd/Ctrl+Alt+Shift is pressed. @public @since 0.16.0_
- `isModEvent(evt?: UserEvent | null): PaneType | boolean`

###  `KeymapContext`

> /** @public
```typescript
export interface KeymapContextextends KeymapInfo
```

###  `KeymapEventHandler`

> /** @public
```typescript
export interface KeymapEventHandlerextends KeymapInfo
```

###  `Modifier`

> /** Mod = Cmd on MacOS and Ctrl on other OS Ctrl = Ctrl key for every OS Meta = Cmd on MacOS and Win key on other OS @public
```typescript
export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';
```

### const `Platform`

> /** @public */ export function parseYaml(yaml: string): any; /** @public @since 0.12.2
```typescript
export const Platform: {
    /**
     * The UI is in desktop mode.
     * @public
     */
    isDesktop: boolean;
```

###  `Scope`

> /** @public */ export function sanitizeHTMLToDom(html: string): DocumentFragment; /** A scope receives keyboard events and binds callbacks to given hotkeys. Only one scope is active at a time, but scopes may define parent scopes (in the constructor) and inherit their hotkeys. @public
```typescript
export class Scope
```

_/** Add a keymap event handler to this scope. @param modifiers - `Mod`, `Ctrl`, `Meta`, `Shift`, or `Alt`. `Mod` translates to `Meta` on macOS and `Ctrl` otherwise. Pass `null` to capture all events matching the `key`, regardless of modifiers. @param key - Keycode from https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key%5FValues @param func - the callback that will be called when a user triggers the keybind. @public_
- `register(modifiers: Modifier[] | null, key: string | null, func: KeymapEventListener): KeymapEventHandler`
_/** Remove an existing keymap event handler. @public_
- `unregister(handler: KeymapEventHandler): void`

---

## UI Components

###  `ButtonComponent`

> /** @public @since 0.9.7
```typescript
export class ButtonComponentextends BaseComponent
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 0.9.7_
- `setCta(): this`
_/** @public @since 0.9.20_
- `removeCta(): this`
_/** @public @since 0.11.0_
- `setWarning(): this`
_/** @public @since 1.1.0_
- `setTooltip(tooltip: string, options?: TooltipOptions): this`
_/** @public @since 0.9.7_
- `setButtonText(name: string): this`
_/** @public @since 1.1.0_
- `setIcon(icon: IconName): this`
_/** @public @since 0.9.7_
- `setClass(cls: string): this`
_/** @public @since 0.12.16_
- `onClick(callback: (evt: MouseEvent) => unknown | Promise<unknown>): this`

###  `ColorComponent`

> /** Color picker component. Values are by default 6-digit hash-prefixed hex strings like `#000000`. @public @since 1.0.0
```typescript
export class ColorComponentextends ValueComponent<string>
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 1.0.0_
- `getValue(): HexString`
_/** @public @since 1.0.0_
- `getValueRgb(): RGB`
_/** @public @since 1.0.0_
- `getValueHsl(): HSL`
_/** @public @since 1.0.0_
- `setValue(value: HexString): this`
_/** @public @since 1.0.0_
- `setValueRgb(rgb: RGB): this`
_/** @public @since 1.0.0_
- `setValueHsl(hsl: HSL): this`
_/** @public @since 1.0.0_
- `onChange(callback: (value: string) => any): this`

###  `DropdownComponent`

> /** @public @since 0.9.7
```typescript
export class DropdownComponentextends ValueComponent<string>
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 0.9.7_
- `addOption(value: string, display: string): this`
_/** @public @since 0.9.7_
- `addOptions(options: Record<string, string>): this`
_/** @public @since 0.9.7_
- `getValue(): string`
_/** @public @since 0.9.7_
- `setValue(value: string): this`
_/** @public @since 0.9.7_
- `onChange(callback: (value: string) => any): this`

###  `ExtraButtonComponent`

> /** @public @since 0.9.7
```typescript
export class ExtraButtonComponentextends BaseComponent
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 1.1.0_
- `setTooltip(tooltip: string, options?: TooltipOptions): this`
_/** @param icon - ID of the icon, can use any icon loaded with {@link addIcon} or from the inbuilt library. @see The Obsidian icon library includes the {@link https://lucide.dev/ Lucide icon library}, any icon name from their site will work here. @public @since 0.9.7_
- `setIcon(icon: IconName): this`
_/** @public @since 0.9.7_
- `onClick(callback: () => any): this`

###  `FuzzySuggestModal`

> /** @public @since 0.9.20
```typescript
export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>>
```

_/** @public @since 0.9.20_
- `getSuggestions(query: string): FuzzyMatch<T>[]`
_/** @public @since 0.9.20_
- `renderSuggestion(item: FuzzyMatch<T>, el: HTMLElement): void`
_/** @public @since 0.9.20_
- `onChooseSuggestion(item: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void`
_/** @public @since 0.9.20_
- `getItems(): T[]`
_/** @public @since 0.9.20_
- `getItemText(item: T): string`
_/** @public @since 0.9.20_
- `onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void`

###  `Menu`

> /** @public
```typescript
export class Menuextends Component implements CloseableComponent
```

_/** @public_
- `setNoIcon(): this`
_/** Force this menu to use native or DOM. (Only works on the desktop app) @public @since 0.16.0_
- `setUseNativeMenu(useNativeMenu: boolean): this`
_/** Adds a menu item. Only works when menu is not shown yet. @public_
- `addItem(cb: (item: MenuItem) => any): this`
_/** Adds a separator. Only works when menu is not shown yet. @public_
- `addSeparator(): this`
_/** @public @since 0.12.6_
- `showAtMouseEvent(evt: MouseEvent): this`
_/** @public @since 1.1.0_
- `showAtPosition(position: MenuPositionDef, doc?: Document): this`
_/** @public_
- `hide(): this`
_/** @public */ close(): void; /** @public_
- `onHide(callback: () => any): void`
_/** @public @since 1.6.0_
- `forEvent(evt: PointerEvent | MouseEvent): Menu`

###  `MenuItem`

> /** @public
```typescript
export class MenuItem
```

_/** @public_
- `setTitle(title: string | DocumentFragment): this`
_/** @param icon - ID of the icon, can use any icon loaded with {@link addIcon} or from the built-in lucide library. @see The Obsidian icon library includes the {@link https://lucide.dev/ Lucide icon library}, any icon name from their site will work here. @public_
- `setIcon(icon: IconName | null): this`
_/** @public_
- `setChecked(checked: boolean | null): this`
_/** @public_
- `setDisabled(disabled: boolean): this`
_/** @param state - If the warning state is enabled If set to true the MenuItem's title and icon will become red. Or whatever color is applied to the class 'is-warning' by a theme. @public @since 0.15.0_
- `setWarning(isWarning: boolean): this`
_/** @public @since 0.15.0_
- `setIsLabel(isLabel: boolean): this`
_/** @public_
- `onClick(callback: (evt: MouseEvent | KeyboardEvent) => any): this`
_/** Sets the section this menu item should belong in. To find the section IDs of an existing menu, inspect the DOM elements to see their `data-section` attribute. @public_
- `setSection(section: string): this`

###  `Modal`

> /** @public
```typescript
export class Modalimplements CloseableComponent
```

_/** Show the modal on the active window. On mobile, the modal will animate on screen. @public_
- `open(): void`
_/** Hide the modal. @public_
- `close(): void`
_/** @public_
- `onOpen(): Promise<void> | void`
_/** @public_
- `onClose(): void`
_/** @public_
- `setTitle(title: string): this`
_/** @public_
- `setContent(content: string | DocumentFragment): this`
_/** @public @since 1.10.0_
- `setCloseCallback(callback: () => any): this`

###  `MomentFormatComponent`

> /** @public */ export const moment: typeof Moment; /** @public @since 0.9.7
```typescript
export class MomentFormatComponentextends TextComponent
```

_/** Sets the default format when input is cleared. Also used for placeholder. @public @since 0.9.7_
- `setDefaultFormat(defaultFormat: string): this`
_/** @public @since 0.9.7_
- `setSampleEl(sampleEl: HTMLElement): this`
_/** @public @since 0.9.7_
- `setValue(value: string): this`
_/** @public @since 0.9.7_
- `onChanged(): void`
_/** @public @since 0.9.7_
- `updateSample(): void`

###  `Notice`

> /** Notification component. Use to present timely, high-value information. @public @since 0.9.7
```typescript
export class Notice
```

_/** Change the message of this notice. @public @since 0.9.7_
- `setMessage(message: string | DocumentFragment): this`
_/** @public @since 0.9.7_
- `hide(): void`

###  `ProgressBarComponent`

> /** @public @since 1.4.4
```typescript
export class ProgressBarComponentextends ValueComponent<number>
```

_/** @public_
- `getValue(): number`
_/** @param value - The progress amount, a value between 0-100. @public_
- `setValue(value: number): this`

###  `SearchComponent`

> /** @public @since 0.9.21
```typescript
export class SearchComponentextends AbstractTextComponent<HTMLInputElement>
```

_/** @public_
- `onChanged(): void`

###  `SecretComponent`

> /** @public @since 1.11.1
```typescript
export class SecretComponentextends BaseComponent
```

_/** @public @since 1.11.4_
- `setValue(value: string): this`
_/** @public @since 1.11.4_
- `onChange(cb: (value: string) => unknown): this`

###  `Setting`

> /** @public @since 0.9.7
```typescript
export class Setting
```

_/** @public @since 0.12.16_
- `setName(name: string | DocumentFragment): this`
_/** @public @since 0.9.7_
- `setDesc(desc: string | DocumentFragment): this`
_/** @public @since 0.9.7_
- `setClass(cls: string): this`
_/** @public @since 1.1.0_
- `setTooltip(tooltip: string, options?: TooltipOptions): this`
_/** @public @since 0.9.16_
- `setHeading(): this`
_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 0.9.7_
- `addButton(cb: (component: ButtonComponent) => any): this`
_/** @public @since 0.9.16_
- `addExtraButton(cb: (component: ExtraButtonComponent) => any): this`
_/** @public @since 0.9.7_
- `addToggle(cb: (component: ToggleComponent) => any): this`
_/** @public @since 0.9.7_
- `addText(cb: (component: TextComponent) => any): this`
_/** @public @since 0.9.21_
- `addSearch(cb: (component: SearchComponent) => any): this`
_/** @public @since 0.9.7_
- `addTextArea(cb: (component: TextAreaComponent) => any): this`
_/** @public @since 0.9.7_
- `addMomentFormat(cb: (component: MomentFormatComponent) => any): this`
_/** @public @ince 0.9.7_
- `addDropdown(cb: (component: DropdownComponent) => any): this`
_/** @public @ince 0.16.0_
- `addColorPicker(cb: (component: ColorComponent) => any): this`
_/** @public @ince 1.4.4_
- `addProgressBar(cb: (component: ProgressBarComponent) => any): this`
_/** @public @since 0.9.7_
- `addSlider(cb: (component: SliderComponent) => any): this`
_/** Facilitates chaining @public @since 0.9.20_
- `then(cb: (setting: this) => any): this`
_/** @public @since 0.13.8_
- `clear(): this`

###  `SliderComponent`

> /** @public @since 0.9.7
```typescript
export class SliderComponentextends ValueComponent<number>
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @param instant whether or not the value should get updated while the slider is dragging @public @since 1.6.6_
- `setInstant(instant: boolean): this`
_/** @public @since 0.9.7_
- `setLimits(min: number | null, max: number | null, step: number | 'any'): this`
_/** @public @since 0.9.7_
- `getValue(): number`
_/** @public @since 0.9.7_
- `setValue(value: number): this`
_/** @public @since 0.9.7_
- `getValuePretty(): string`
_/** @public @since 0.9.7_
- `setDynamicTooltip(): this`
_/** @public @since 0.9.7_
- `showTooltip(): void`
_/** @public @since 0.9.7_
- `onChange(callback: (value: number) => any): this`

###  `SuggestModal`

> /** @public @ince 0.9.20
```typescript
export abstract class SuggestModal<T> extends Modal implements ISuggestOwner<T>
```

_/** @public @since 0.9.20_
- `setPlaceholder(placeholder: string): void`
_/** @public @since 0.9.20_
- `setInstructions(instructions: Instruction[]): void`
_/** @public @since 0.9.20_
- `onNoSuggestion(): void`
_/** @public @since 0.9.20_
- `selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void`
_/** @public @since 1.7.2_
- `selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void`
_/** @public @since 1.5.7_
- `getSuggestions(query: string): T[] | Promise<T[]>`
_/** @public @since 1.5.7_
- `renderSuggestion(value: T, el: HTMLElement): void`
_/** @public @since 1.5.7_
- `onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void`

###  `TextAreaComponent`

> /** @public @since 0.9.7
```typescript
export class TextAreaComponentextends AbstractTextComponent<HTMLTextAreaElement>
```

###  `TextComponent`

> /** @public @since 0.9.21
```typescript
export class TextComponentextends AbstractTextComponent<HTMLInputElement>
```

###  `ToggleComponent`

> /** @public @since 0.9.7
```typescript
export class ToggleComponentextends ValueComponent<boolean>
```

_/** @public @since 1.2.3_
- `setDisabled(disabled: boolean): this`
_/** @public @since 0.9.7_
- `getValue(): boolean`
_/** @public @since 0.9.7_
- `setValue(on: boolean): this`
_/** @public @since 1.1.1_
- `setTooltip(tooltip: string, options?: TooltipOptions): this`
_/** @public @since 0.9.7_
- `onClick(): void`
_/** @public @since 0.9.7_
- `onChange(callback: (value: boolean) => any): this`

---

## Bases API (v1.10.0+)

###  `BasesAllOptions`

> /** BasesOptions and the associated sub-types are configuration-driven settings controls which can be provided by a {@link BasesViewRegistration} to expose configuration options to users in the view config menu of the Bases toolbar. @public @since 1.10.0
```typescript
export type BasesAllOptions = BasesOptions | BasesOptionGroup<BasesOptions>;
```

###  `BasesConfigFile`

> /** Represents the serialized format of a Bases query as stored in a `.base` file. @public @since 1.10.0
```typescript
export interface BasesConfigFile
```

###  `BasesConfigFileFilter`

> /** @public @since 1.10.0
```typescript
export type BasesConfigFileFilter = string | {
    /**
     * @public
     * @since 1.10.0
     */
    and: BasesConfigFileFilter[];
```

###  `BasesConfigFileView`

> /** @public @since 1.10.0
```typescript
export interface BasesConfigFileView
```

###  `BasesDropdownOption`

> /** @public @since 1.10.0
```typescript
export interface BasesDropdownOptionextends BasesOption
```

###  `BasesEntry`

> /** Represent a single "row" or file in a base. @public @since 1.10.0
```typescript
export class BasesEntryimplements FormulaContext
```

_/** Get the value of the property. Note: Errors are returned as {@link ErrorValue} @public @since 1.10.0_
- `getValue(propertyId: BasesPropertyId): Value | null`

###  `BasesEntryGroup`

> /** A group of BasesEntry objects for a given value of the groupBy key. If there are entries in the results which do not have a value for the groupBy key, the key will be the {@link NullValue}. @public @since 1.10.0
```typescript
export class BasesEntryGroup
```

_/** @returns true iff this entry group has a non-null key. @public @since 1.10.0_
- `hasKey(): boolean`

###  `BasesFileOption`

> /** A text input allowing selection of a file from in the vault. @public @since 1.10.2
```typescript
export interface BasesFileOptionextends BasesOption
```

###  `BasesFolderOption`

> /** A text input allowing selection of a folder from in the vault. @public @since 1.10.2
```typescript
export interface BasesFolderOptionextends BasesOption
```

###  `BasesFormulaOption`

> /** A text input supporting formula evaluation. @public @since 1.10.2
```typescript
export interface BasesFormulaOptionextends BasesOption
```

###  `BasesMultitextOption`

> /** @public @since 1.10.0
```typescript
export interface BasesMultitextOptionextends BasesOption
```

###  `BasesOption`

> /** @public @since 1.10.0
```typescript
export interface BasesOption
```

###  `BasesOptionGroup`

> /** Collapsible container for other ViewOptions. @public @since 1.10.0
```typescript
export interface BasesOptionGroup<T extends BasesOption>
```

###  `BasesOptions`

> /** @public @since 1.10.0
```typescript
export type BasesOptions = BasesDropdownOption | BasesFileOption | BasesFolderOption | BasesFormulaOption | BasesMultitextOption | BasesPropertyOption | BasesSliderOption | BasesTextOption | BasesToggleOption;
```

###  `BasesProperty`

> /** A parsed version of the {@link BasesPropertyId}. @public @since 1.10.0
```typescript
export interface BasesProperty
```

###  `BasesPropertyId`

> /** The full ID of a property, used in the bases config file. The prefixed {@link BasesPropertyType} disambiguates properties of the same name but from different sources. @public @since 1.10.0
```typescript
export type BasesPropertyId = `${BasesPropertyType}.${string}`;
```

###  `BasesPropertyOption`

> /** A dropdown menu allowing selection of a property. @public @since 1.10.0
```typescript
export interface BasesPropertyOptionextends BasesOption
```

###  `BasesPropertyType`

> /** The three valid "sources" of a property in a Base. - `note`: Properties from the frontmatter of markdown files in the vault. - `formula`: Properties calculated by evaluating a formula from the base config file. - `file`: Properties inherent to a file, such as the name, extension, size, etc. @public @since 1.10.0
```typescript
export type BasesPropertyType = 'note' | 'formula' | 'file';
```

###  `BasesQueryResult`

> /** The BasesQueryResult contains all of the available information from executing the bases query, applying filters, and evaluating formulas. The `data` or `groupedData` should be displayed by your view. @public @since 1.10.0
```typescript
export class BasesQueryResult
```

_/** The data to be rendered, grouped according to the groupBy config. If there is no groupBy configured, returns a single group with an empty key. @public @since 1.10.0_
- `groupedData(): BasesEntryGroup[]`
_/** Visible properties defined by the user. @public @since 1.10.0_
- `properties(): BasesPropertyId[]`
_/** Applies a summary function to a single property over a set of entries. @public @since 1.10.0_
- `getSummaryValue(queryController: QueryController, entries: BasesEntry[], prop: BasesPropertyId, summaryKey: string): Value`

###  `BasesSliderOption`

> /** @public @since 1.10.0
```typescript
export interface BasesSliderOptionextends BasesOption
```

###  `BasesSortConfig`

> /** @public @since 1.10.0
```typescript
export type BasesSortConfig = {
    /**
     * @public
     * @since 1.10.0
     */
    property: BasesPropertyId;
```

###  `BasesTextOption`

> /** @public @since 1.10.0
```typescript
export interface BasesTextOptionextends BasesOption
```

###  `BasesToggleOption`

> /** @public @since 1.10.0
```typescript
export interface BasesToggleOptionextends BasesOption
```

###  `BasesView`

> /** Plugins can create a class which extends this in order to render a Base. Plugins should create a {@link BaseViewHandlerFactory} function, then call `plugin.registerView` to register the view factory. @public @since 1.10.0
```typescript
export abstract class BasesViewextends Component
```

_/** Called when there is new data for the query. This view should rerender with the updated data. @public @since 1.10.0_
- `onDataUpdated(): void`
_/** Display the new note menu for a file with the provided filename and optionally a function to modify the frontmatter. @public @since 1.10.2_
- `createFileForView(baseFileName?: string, frontmatterProcessor?: (frontmatter: any) => void): Promise<void>`

###  `BasesViewConfig`

> /** The in-memory representation of a single entry in the "views" section of a Bases file. Contains settings and configuration options set by the user from the toolbar menus and view options. @public @since 1.10.0
```typescript
export class BasesViewConfig
```

_/** Retrieve the user-configured value of options exposed in `BasesViewRegistration.options`. @public @since 1.10.0_
- `get(key: string): unknown`
_/** Retrieve a user-configured value from the config, converting it to a BasesPropertyId. Returns null if the requested key is not present in the config, or if the value is invalid. @public @since 1.10.0_
- `getAsPropertyId(key: string): BasesPropertyId | null`
_/** Retrieve a user-configured value from the config, evaluating it as a formula in the context of the current Base. For embedded bases, or bases in the sidebar, this means evaluating the formula against the currently active file. @public @returns the Value result from evaluating the formula, or NullValue if the formula is invalid, or the key is not present. @since 1.10.2_
- `getEvaluatedFormula(view: BasesView, key: string): Value`
_/** Store configuration data for the view. Views should prefer `BasesViewRegistration.options` to allow users to configure options where appropriate. @public @since 1.10.0_
- `set(key: string, value: any | null): void`
_/** Ordered list of properties to display in this view. In a table, these can be interpreted as the list of visible columns. Order is configured by the user through the properties toolbar menu. @public @since 1.10.0_
- `getOrder(): BasesPropertyId[]`
_/** Retrieve the sorting config for this view. Sort is configured by the user through the sort toolbar menu. Removes invalid sort configs. If no (valid) sort config, returns an empty array. Does not validate that the properties exists. Note that data from BasesQueryResult will be presorted. @public @since 1.10.0_
- `getSort(): BasesSortConfig[]`
_/** Retrieve a friendly name for the provided property. If the property has been renamed by the user in the Base config, that value is returned. File properties may have a default name that is returned, otherwise the name with the property type prefix removed is returned. @public @since 1.10.0_
- `getDisplayName(propertyId: BasesPropertyId): string`

###  `BasesViewFactory`

> /** Implement this factory function in a {@link BasesViewRegistration} to create a new instance of a custom Bases view. @param containerEl - The container below the Bases toolbar where the view will be displayed. @public @since 1.10.0
```typescript
export type BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView;
```

###  `BasesViewRegistration`

> /** Container for options when registering a new Bases view type. @public @since 1.10.0
```typescript
export interface BasesViewRegistration
```

###  `QueryController`

> /** Responsible for executing the Bases query and evaluating filters and formulas. Notifies views of updated results. @public @since 1.10.0
```typescript
export class QueryControllerextends Component
```

## Utility Functions

### addIcon

> /** Adds an icon to the library. @param iconId - the icon ID @param svgContent - the content of the SVG. @public
```typescript
export function addIcon(iconId: string, svgContent: string): void;
```

### arrayBufferToHex

> /** @public */ export function arrayBufferToBase64(buffer: ArrayBuffer): string; /** @public */
```typescript
export function arrayBufferToHex(data: ArrayBuffer): string;
```

### debounce

> /** A standard debounce function. Use this to have a time-delayed function only be called once in a given timeframe. @param cb - The function to call. @param timeout - The timeout to wait, in milliseconds @param resetTimer - Whether to reset the timeout when the debounce function is called again. @returns a debounced function that takes the same parameter as the original function. @example ```ts const debounced = debounce((text: string) => { console.log(text); }, 1000, true); debounced('Hello world'); // this will not be printed await sleep(500); debounced('World, hello'); // this will be printed to the console. ``` @public
```typescript
export function debounce<T extends unknown[], V>(cb: (...args: [...T]) => V, timeout?: number, resetTimer?: boolean): Debouncer<T, V>;
```

### displayTooltip

> /** Manually trigger a tooltip that will appear over the provided element. To display a tooltip on hover, use {@link setTooltip} instead. @public @since 1.8.7
```typescript
export function displayTooltip(newTargetEl: HTMLElement, content: string | DocumentFragment, options?: TooltipOptions): void;
```

### finishRenderMath

> /** Flush the MathJax stylesheet. @public
```typescript
export function finishRenderMath(): Promise<void>;
```

### getAllTags

> /** Combines all tags from frontmatter and note content into a single array. @public
```typescript
export function getAllTags(cache: CachedMetadata): string[] | null;
```

### getFrontMatterInfo

> /** @public */ export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer>; /** Given the contents of a file, get information about the frontmatter of the file, including whether there is a frontmatter block, the offsets of where it starts and ends, and the frontmatter text. @public @since 1.5.7
```typescript
export function getFrontMatterInfo(content: string): FrontMatterInfo;
```

### getIcon

> /** Create an SVG from an iconId. Returns null if no icon associated with the iconId. @param iconId - the icon ID @public
```typescript
export function getIcon(iconId: string): SVGSVGElement | null;
```

### getIconIds

> /** Get the list of registered icons. @public
```typescript
export function getIconIds(): IconName[];
```

### getLanguage

> /** Get the ISO code for the currently configured app language. Defaults to 'en'. See {@link https://github.com/obsidianmd/obsidian-translations?tab=readme-ov-file#existing-languages} for list of options. @public @since 1.8.7
```typescript
export function getLanguage(): string;
```

### getLinkpath

> /** Converts the linktext to a linkpath. @param linktext A wikilink without the leading [[ and trailing ]] @returns the name of the file that is being linked to. @public
```typescript
export function getLinkpath(linktext: string): string;
```

### htmlToMarkdown

> /** Converts HTML to a Markdown string. @public
```typescript
export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string;
```

### iterateCacheRefs

> /** Iterate links and embeds. If callback returns true, the iteration process will be interrupted. @returns true if callback ever returns true, false otherwise. @public @deprecated
```typescript
export function iterateCacheRefs(cache: CachedMetadata, cb: (ref: ReferenceCache) => boolean | void): boolean;
```

### iterateRefs

> /** If callback returns true, the iteration process will be interrupted. @returns true if callback ever returns true, false otherwise. @public
```typescript
export function iterateRefs(refs: Reference[], cb: (ref: Reference) => boolean | void): boolean;
```

### loadMathJax

> /** Load MathJax. @see {@link https://www.mathjax.org/ Official MathJax documentation} @public
```typescript
export function loadMathJax(): Promise<void>;
```

### loadMermaid

> /** Load Mermaid and return a promise to the global mermaid object. Can also use `mermaid` after this promise resolves to get the same reference. @see {@link https://mermaid.js.org/ Official Mermaid documentation} @public
```typescript
export function loadMermaid(): Promise<any>;
```

### loadPdfJs

> /** Load PDF.js and return a promise to the global pdfjsLib object. Can also use `window.pdfjsLib` after this promise resolves to get the same reference. @see {@link https://mozilla.github.io/pdf.js/ Official PDF.js documentation} @public
```typescript
export function loadPdfJs(): Promise<any>;
```

### loadPrism

> /** Load Prism.js and return a promise to the global Prism object. Can also use `Prism` after this promise resolves to get the same reference. @see {@link https://prismjs.com/ Official Prism documentation} @public
```typescript
export function loadPrism(): Promise<any>;
```

### normalizePath

> /** @public
```typescript
export function normalizePath(path: string): string;
```

### parseFrontMatterAliases

> /** @public
```typescript
export function parseFrontMatterAliases(frontmatter: any | null): string[] | null;
```

### parseFrontMatterEntry

> /** @public
```typescript
export function parseFrontMatterEntry(frontmatter: any | null, key: string | RegExp): any | null;
```

### parseFrontMatterStringArray

> /** @public
```typescript
export function parseFrontMatterStringArray(frontmatter: any | null, key: string | RegExp): string[] | null;
```

### parseFrontMatterTags

> /** @public
```typescript
export function parseFrontMatterTags(frontmatter: any | null): string[] | null;
```

### parseLinktext

> /** Parses the linktext of a wikilink into its component parts. @param linktext A wikilink without the leading [[ and trailing ]] @returns filepath and subpath (subpath can refer either to a block id, or a heading) @public
```typescript
export function parseLinktext(linktext: string): {
```

### parsePropertyId

> /** Split a Bases property ID into constituent parts. @public @since 1.10.0
```typescript
export function parsePropertyId(propertyId: BasesPropertyId): BasesProperty;
```

### prepareFuzzySearch

> /** Construct a fuzzy search callback that runs on a target string. Performance may be an issue if you are running the search for more than a few thousand times. If performance is a problem, consider using `prepareSimpleSearch` instead. @param query - the fuzzy query. @return fn - the callback function to apply the search on. @public
```typescript
export function prepareFuzzySearch(query: string): (text: string) => SearchResult | null;
```

### prepareSimpleSearch

> /** Construct a simple search callback that runs on a target string. @param query - the space-separated words @return fn - the callback function to apply the search on @public
```typescript
export function prepareSimpleSearch(query: string): (text: string) => SearchResult | null;
```

### removeIcon

> /** Remove a custom icon from the library. @param iconId - the icon ID @public
```typescript
export function removeIcon(iconId: string): void;
```

### renderMatches

> /** @public
```typescript
export function renderMatches(el: HTMLElement | DocumentFragment, text: string, matches: SearchMatches | null, offset?: number): void;
```

### renderMath

> /** Render some LaTeX math using the MathJax engine. Returns an HTMLElement. Requires calling `finishRenderMath` when rendering is all done to flush the MathJax stylesheet. @public
```typescript
export function renderMath(source: string, display: boolean): HTMLElement;
```

### renderResults

> /** @public
```typescript
export function renderResults(el: HTMLElement, text: string, result: SearchResult, offset?: number): void;
```

### request

> /** Similar to `fetch()`, request a URL using HTTP/HTTPS, without any CORS restrictions. Returns the text value of the response. @public @since 0.12.11
```typescript
export function request(request: RequestUrlParam | string): Promise<string>;
```

### requestUrl

> /** Similar to `fetch()`, request a URL using HTTP/HTTPS, without any CORS restrictions. @public
```typescript
export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise;
```

### requireApiVersion

> /** Returns true if the API version is equal or higher than the requested version. Use this to limit functionality that require specific API versions to avoid crashing on older Obsidian builds. @public
```typescript
export function requireApiVersion(version: string): boolean;
```

### resolveSubpath

> /** Resolve the given subpath to a reference in the MetadataCache. @public
```typescript
export function resolveSubpath(cache: CachedMetadata, subpath: string): HeadingSubpathResult | BlockSubpathResult | FootnoteSubpathResult | null;
```

### setIcon

> /** Insert an SVG into the element from an iconId. Does nothing if no icon associated with the iconId. @param parent - the HTML element to insert the icon @param iconId - the icon ID @see The Obsidian icon library includes the {@link https://lucide.dev/ Lucide icon library}, any icon name from their site will work here. @public
```typescript
export function setIcon(parent: HTMLElement, iconId: IconName): void;
```

### setTooltip

> /** @param el - The element to show the tooltip on @param tooltip - The tooltip text to show @param options @public @since 1.4.4
```typescript
export function setTooltip(el: HTMLElement, tooltip: string, options?: TooltipOptions): void;
```

### sortSearchResults

> /** @public
```typescript
export function sortSearchResults(results: SearchResultContainer[]): void;
```

### stripHeading

> /** Normalizes headings for link matching by stripping out special characters and shrinking consecutive spaces. @public
```typescript
export function stripHeading(heading: string): string;
```

### stripHeadingForLink

> /** Prepares headings for linking by stripping out some bad combinations of special characters that could break links. @public
```typescript
export function stripHeadingForLink(heading: string): string;
```
