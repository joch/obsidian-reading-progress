import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Notice, Platform } from 'obsidian';

interface FrontmatterFilter {
	key: string;
	value: string;
}

interface ReadingProgressSettings {
	enabledPaths: string[];
	frontmatterFilters: FrontmatterFilter[];
	tagFilters: string[];
	saveInterval: number;
	showNotice: boolean;
	showDebugLogs: boolean;
}

const DEFAULT_SETTINGS: ReadingProgressSettings = {
	enabledPaths: [],
	frontmatterFilters: [],
	tagFilters: [],
	saveInterval: 500,
	showNotice: true,
	showDebugLogs: false
}

/**
 * Debounce function - only executes after the specified delay of inactivity
 * Waits until user stops scrolling before saving (reduces writes)
 */
function debounce<T extends (...args: any[]) => any>(
	func: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			func(...args);
			timeoutId = null;
		}, delay);
	};
}

export default class ReadingProgressPlugin extends Plugin {
	settings: ReadingProgressSettings;
	private currentScrollHandler: (() => void) | null = null;
	private currentScrollElement: HTMLElement | null = null;
	private lastSavedPositions: Map<string, number> = new Map();
	private isRestoring: boolean = false;
	private currentTrackedFile: string | null = null;

	async onload() {
		await this.loadSettings();

		this.log('Reading Progress plugin loaded');

		// Add settings tab
		this.addSettingTab(new ReadingProgressSettingTab(this.app, this));

		// Register file open event - restore position when file opens
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.onFileOpen(file);
			})
		);

		// Register layout change event - for view mode switches
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.updateScrollTracking();
			})
		);

		// Add command to manually save position
		this.addCommand({
			id: 'save-reading-position',
			name: 'Save reading position',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					await this.saveScrollPosition(file);
					new Notice('Reading position saved');
				}
			}
		});

		// Add command to manually restore position
		this.addCommand({
			id: 'restore-reading-position',
			name: 'Restore reading position',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					await this.restoreScrollPosition(file, true);
				}
			}
		});
	}

	onunload() {
		this.cleanupScrollTracking();
		this.log('Reading Progress plugin unloaded');
	}

	private log(message: string, ...args: any[]) {
		if (this.settings.showDebugLogs) {
			console.log(`[Reading Progress] ${message}`, ...args);
		}
	}

	async onFileOpen(file: TFile | null) {
		// Clean up tracking for previous file
		this.cleanupScrollTracking();

		if (!file) return;

		this.log('File opened:', file.path);

		if (!this.shouldTrackFile(file)) {
			this.log('File does not match filters, skipping:', file.path);
			return;
		}

		this.log('File matches filters, setting up tracking:', file.path);

		// Restore scroll position
		await this.restoreScrollPosition(file, false);

		// Set up scroll tracking
		this.setupScrollTracking(file);
	}

	setupScrollTracking(file: TFile) {
		// Clean up any existing handler first
		this.cleanupScrollTracking();

		// Get the active markdown view
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			this.log('No markdown view found');
			return;
		}

		// Find the scroll container
		const scrollEl = this.getScrollElement(view);
		if (!scrollEl) {
			this.log('No scroll element found');
			return;
		}

		this.log('Setting up scroll tracking for:', file.path, 'with delay:', this.settings.saveInterval, 'ms');

		// Create debounced scroll handler
		const handler = debounce(() => {
			this.saveScrollPosition(file);
		}, this.settings.saveInterval);

		// Register scroll listener manually (so we can properly remove it)
		scrollEl.addEventListener('scroll', handler);

		// Store references for cleanup
		this.currentScrollHandler = handler;
		this.currentScrollElement = scrollEl;
		this.currentTrackedFile = file.path;

		this.log('Scroll tracking active on element');
	}

	cleanupScrollTracking() {
		if (this.currentScrollHandler && this.currentScrollElement) {
			this.log('Cleaning up scroll tracking for:', this.currentTrackedFile);
			this.currentScrollElement.removeEventListener('scroll', this.currentScrollHandler);
		}
		this.currentScrollHandler = null;
		this.currentScrollElement = null;
		this.currentTrackedFile = null;
	}

	updateScrollTracking() {
		const file = this.app.workspace.getActiveFile();
		if (file && this.shouldTrackFile(file)) {
			this.log('Layout changed, updating scroll tracking');
			this.setupScrollTracking(file);
		}
	}

	getScrollElement(view: MarkdownView): HTMLElement | null {
		// Check which mode we're in
		const mode = view.getMode();
		const modeName = mode === 'preview' ? 'Reading mode' : 'Edit mode (Live Preview or Source)';
		this.log('View mode:', modeName, `(API mode: ${mode})`);

		let selectors: string[];

		if (mode === 'preview') {
			// Reading mode - look for reading view container
			selectors = [
				'.markdown-preview-view',
				'.markdown-reading-view',
				'.markdown-preview-section'
			];
		} else {
			// Live Preview or Source mode - look for editor container
			selectors = [
				'.cm-scroller',
				'.markdown-source-view'
			];
		}

		// Try mode-specific selectors first
		for (const selector of selectors) {
			const element = view.contentEl.querySelector(selector) as HTMLElement;
			if (element) {
				this.log('Found scroll element with selector:', selector, 'in mode:', mode);
				return element;
			}
		}

		this.log('No scroll element found with mode-specific selectors, trying contentEl directly');
		return view.contentEl;
	}

	async saveScrollPosition(file: TFile) {
		if (this.isRestoring) {
			this.log('Currently restoring, skipping save');
			return;
		}

		// Validate that this file is still the active file
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.path !== file.path) {
			this.log('File is no longer active, skipping save for:', file.path, '(active:', activeFile?.path, ')');
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		let scrollPosition: number | undefined;

		// Always get scroll position from DOM to ensure consistency
		const scrollEl = this.getScrollElement(view);
		if (!scrollEl || scrollEl.scrollHeight === 0) {
			this.log('Could not get scroll position - no scroll element or zero height');
			return;
		}

		const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
		if (maxScroll <= 0) {
			this.log('Document not scrollable, maxScroll:', maxScroll);
			return;
		}

		// Calculate percentage (0-1)
		const scrollPercent = scrollEl.scrollTop / maxScroll;
		scrollPosition = Number(scrollPercent.toFixed(4));

		this.log('Got scroll position - scrollTop:', scrollEl.scrollTop, 'maxScroll:', maxScroll, 'percent:', scrollPosition);

		// Check if position has changed significantly (avoid unnecessary writes)
		const lastSaved = this.lastSavedPositions.get(file.path);
		if (lastSaved !== undefined && Math.abs(lastSaved - scrollPosition) < 0.001) {
			return; // Position hasn't changed enough
		}

		this.log('Saving scroll position:', scrollPosition, 'for:', file.path);

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter.reading_progress = scrollPosition;
			});

			// Update last saved position
			this.lastSavedPositions.set(file.path, scrollPosition);
		} catch (error) {
			console.error('Failed to save reading progress:', error);
		}
	}

	async restoreScrollPosition(file: TFile, showNoticeAlways: boolean) {
		const cache = this.app.metadataCache.getFileCache(file);
		const savedProgress = cache?.frontmatter?.reading_progress;

		if (savedProgress === undefined || savedProgress === null) {
			this.log('No saved progress found for:', file.path);
			return;
		}

		// Validate that savedProgress is a reasonable percentage (0-1)
		if (savedProgress < 0 || savedProgress > 1) {
			this.log('Invalid saved progress value:', savedProgress, '- resetting to 0');
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			this.log('No markdown view found for restoration');
			return;
		}

		this.log('Restoring scroll position:', savedProgress, 'for:', file.path);

		// Set flag to prevent save during restoration
		this.isRestoring = true;

		// Add delay to prevent conflicts with anchor navigation and allow view to fully render
		setTimeout(() => {
			try {
				const scrollEl = this.getScrollElement(view);
				if (!scrollEl || scrollEl.scrollHeight === 0) {
					this.log('No scroll element for restoration');
					this.isRestoring = false;
					return;
				}

				const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
				const targetScroll = savedProgress * maxScroll;

				this.log('Restoring scroll - savedProgress:', savedProgress, 'maxScroll:', maxScroll, 'target:', targetScroll);

				scrollEl.scrollTop = targetScroll;

				// Update last saved position to prevent immediate re-save
				this.lastSavedPositions.set(file.path, savedProgress);

				if (this.settings.showNotice || showNoticeAlways) {
					const percentage = Math.round(savedProgress * 100);
					new Notice(`📖 Restored to ${percentage}% of document`);
				}

				// Clear restoration flag after a delay
				setTimeout(() => {
					this.isRestoring = false;
					this.log('Restoration complete, tracking enabled');
				}, 300);
			} catch (error) {
				console.error('Failed to restore reading progress:', error);
				this.isRestoring = false;
			}
		}, 150);
	}

	shouldTrackFile(file: TFile): boolean {
		// If no filters are set, don't track any files (opt-in approach)
		const hasFilters =
			this.settings.enabledPaths.length > 0 ||
			this.settings.frontmatterFilters.length > 0 ||
			this.settings.tagFilters.length > 0;

		if (!hasFilters) {
			return false;
		}

		// Check path filter
		if (this.settings.enabledPaths.length > 0) {
			const matchesPath = this.settings.enabledPaths.some(path => {
				const normalizedPath = path.trim();
				return file.path.startsWith(normalizedPath);
			});

			if (matchesPath) {
				this.log('File matches path filter:', file.path);
				return true;
			}
		}

		// Get file metadata
		const cache = this.app.metadataCache.getFileCache(file);

		// Check frontmatter filters
		if (this.settings.frontmatterFilters.length > 0) {
			const matchesFrontmatter = this.settings.frontmatterFilters.some(filter => {
				const value = cache?.frontmatter?.[filter.key];
				const matches = String(value) === filter.value;
				if (matches) {
					this.log('File matches frontmatter filter:', filter.key, '=', filter.value);
				}
				return matches;
			});

			if (matchesFrontmatter) {
				return true;
			}
		}

		// Check tag filters
		if (this.settings.tagFilters.length > 0) {
			// Get frontmatter tags
			const frontmatterTags = cache?.frontmatter?.tags || [];
			const frontmatterTagsArray = Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags];

			// Get inline tags from content
			const inlineTags = cache?.tags?.map(t => t.tag) || [];

			// Combine all tags
			const allTags = [...frontmatterTagsArray, ...inlineTags];

			const matchesTag = this.settings.tagFilters.some(filterTag => {
				const normalizedFilterTag = filterTag.trim().startsWith('#') ? filterTag.trim() : '#' + filterTag.trim();
				const matches = allTags.some(tag => {
					const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
					return normalizedTag === normalizedFilterTag;
				});
				if (matches) {
					this.log('File matches tag filter:', filterTag);
				}
				return matches;
			});

			if (matchesTag) {
				return true;
			}
		}

		return false;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ReadingProgressSettingTab extends PluginSettingTab {
	plugin: ReadingProgressPlugin;

	constructor(app: App, plugin: ReadingProgressPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Reading Progress Settings' });

		containerEl.createEl('p', {
			text: 'Configure which files should track reading progress. Files must match at least one filter to be tracked.',
			cls: 'setting-item-description'
		});

		// Enabled paths
		new Setting(containerEl)
			.setName('Enabled paths')
			.setDesc('Track files in these folders (comma-separated). Example: books/,articles/,notes/')
			.addTextArea(text => {
				text.inputEl.style.width = '100%';
				text.inputEl.style.minHeight = '60px';
				text
					.setPlaceholder('books/,articles/')
					.setValue(this.plugin.settings.enabledPaths.join(',\n'))
					.onChange(async (value) => {
						this.plugin.settings.enabledPaths = value
							.split(',')
							.map(s => s.trim())
							.filter(s => s.length > 0);
						await this.plugin.saveSettings();
					});
			});

		// Frontmatter filters
		containerEl.createEl('h3', { text: 'Frontmatter Filters' });
		containerEl.createEl('p', {
			text: 'Track files with specific frontmatter values. Add one filter per line in format: key=value',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Frontmatter filters')
			.setDesc('Example: type=reading or status=in-progress (one per line)')
			.addTextArea(text => {
				text.inputEl.style.width = '100%';
				text.inputEl.style.minHeight = '80px';
				const filterStrings = this.plugin.settings.frontmatterFilters
					.map(f => `${f.key}=${f.value}`);
				text
					.setPlaceholder('type=reading\nstatus=in-progress')
					.setValue(filterStrings.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.frontmatterFilters = value
							.split('\n')
							.map(line => line.trim())
							.filter(line => line.length > 0 && line.includes('='))
							.map(line => {
								const [key, ...valueParts] = line.split('=');
								return {
									key: key.trim(),
									value: valueParts.join('=').trim()
								};
							});
						await this.plugin.saveSettings();
					});
			});

		// Tag filters
		new Setting(containerEl)
			.setName('Tag filters')
			.setDesc('Track files with these tags (comma-separated). Example: #reading,#book,#article')
			.addTextArea(text => {
				text.inputEl.style.width = '100%';
				text.inputEl.style.minHeight = '60px';
				text
					.setPlaceholder('#reading,#book,#article')
					.setValue(this.plugin.settings.tagFilters.join(',\n'))
					.onChange(async (value) => {
						this.plugin.settings.tagFilters = value
							.split(',')
							.map(s => s.trim())
							.filter(s => s.length > 0);
						await this.plugin.saveSettings();
					});
			});

		// Behavior settings
		containerEl.createEl('h3', { text: 'Behavior' });

		new Setting(containerEl)
			.setName('Save delay')
			.setDesc('How long to wait after scrolling stops before saving position (milliseconds). Lower = more responsive, higher = fewer writes.')
			.addSlider(slider => slider
				.setLimits(100, 3000, 100)
				.setValue(this.plugin.settings.saveInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.saveInterval = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show restore notice')
			.setDesc('Display notification when restoring scroll position on file open')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showNotice)
				.onChange(async (value) => {
					this.plugin.settings.showNotice = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show debug logs')
			.setDesc('Show detailed logging in developer console (useful for troubleshooting)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showDebugLogs)
				.onChange(async (value) => {
					this.plugin.settings.showDebugLogs = value;
					await this.plugin.saveSettings();
				}));

		// Status info
		containerEl.createEl('h3', { text: 'Status' });
		const statusDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		statusDiv.createEl('p', { text: `Platform: ${Platform.isDesktopApp ? 'Desktop' : 'Mobile'}` });
		statusDiv.createEl('p', { text: `Active filters: ${this.getActiveFiltersCount()}` });
	}

	getActiveFiltersCount(): number {
		return this.plugin.settings.enabledPaths.length +
			this.plugin.settings.frontmatterFilters.length +
			this.plugin.settings.tagFilters.length;
	}
}
