# Reading Progress

Track and restore your reading position in Obsidian notes. Never lose your place in long documents again.

Reading Progress automatically saves your scroll position to frontmatter and restores it when you reopen files. Perfect for tracking progress in books, long articles, research papers, or any lengthy notes.

## Features

- **Automatic position tracking** - Saves scroll position as you read (debounced to avoid excessive writes)
- **Persistent across sessions** - Restores position when reopening files
- **Flexible filtering** - Track files by path, frontmatter, or tags
- **Opt-in approach** - Only tracks files matching your configured filters
- **Cross-platform** - Works on Desktop and Mobile
- **All view modes** - Reading mode, Live Preview, and Source mode
- **Manual controls** - Commands to save/restore position on demand
- **Configurable behavior** - Adjust save delay, notifications, and debug logging
- **Lightweight** - Stores position as single percentage value in frontmatter

## Installation

### Via BRAT (Recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Open Command Palette and run "BRAT: Add a beta plugin for testing"
3. Enter: `joch/obsidian-reading-progress`
4. Enable the plugin in Settings → Community Plugins

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/joch/obsidian-reading-progress/releases)
2. Create folder: `VaultFolder/.obsidian/plugins/reading-progress/`
3. Copy downloaded files to the folder
4. Enable the plugin in Settings → Community Plugins

## Configuration

Go to Settings → Reading Progress to configure which files should be tracked.

**Important**: Files must match at least one filter to be tracked (opt-in approach).

### Filter Types

#### Path Filters
Track all files in specific folders (comma-separated):
```
books/,articles/,research/
```

#### Frontmatter Filters
Track files with specific frontmatter values (one per line, format: `key=value`):
```
type=book
status=reading
media=article
```

#### Tag Filters
Track files with specific tags (comma-separated):
```
#reading,#book,#article
```

### Settings

- **Save delay** (100-3000ms) - How long to wait after scrolling stops before saving. Lower = more responsive, higher = fewer writes. Default: 500ms
- **Show restore notice** - Display notification when position is restored on file open
- **Show debug logs** - Enable detailed console logging for troubleshooting

## Usage

### Example: Track all books

Set path filter to:
```
books/
```

Now all files in your `books/` folder will automatically track reading progress.

### Example: Track clippings being read

Set frontmatter filter to:
```
type=clipping
read_status=reading
```

This tracks all clipping notes that you're currently reading.

### Example: Track by tag

Set tag filter to:
```
#reading,#longform
```

This tracks any file tagged with `#reading` or `#longform`.

### Example: Combined filters

You can use multiple filter types simultaneously. A file only needs to match ONE filter to be tracked.

For example:
- Path filter: `books/`
- Frontmatter filter: `type=article`
- Tag filter: `#reading`

This will track:
- All files in `books/` folder, OR
- Any file with `type: article` frontmatter, OR
- Any file with `#reading` tag

### Manual Commands

The plugin provides two commands accessible via Command Palette (Cmd/Ctrl + P):

- **Save reading position** - Manually save current scroll position
- **Restore reading position** - Manually restore saved position

These are useful for testing or forcing a save/restore without waiting for automatic triggers.

## How It Works

Reading Progress stores scroll position as a percentage (0-1) in the `reading_progress` frontmatter field:

```yaml
---
title: My Long Article
reading_progress: 0.4523
---
```

This percentage-based approach:
- **Adapts to content changes** - Position remains accurate even if content is added/removed above
- **Minimal storage** - Single decimal value per file
- **Cross-device compatible** - Works consistently across desktop and mobile

### Debounced Saving

The plugin uses debounced saving (default 500ms) to avoid writing to files too frequently:
- Waits for you to stop scrolling before saving
- Reduces file modifications and performance impact
- Only saves if position changed significantly (>0.1%)

### View Mode Support

Works in all Obsidian view modes:
- **Reading mode** - Tracks `.markdown-preview-view` container
- **Live Preview** - Tracks `.cm-scroller` editor container
- **Source mode** - Tracks `.markdown-source-view` container

## Troubleshooting

### My files aren't being tracked

1. Check that you've configured at least one filter in Settings → Reading Progress
2. Enable "Show debug logs" to see which files match your filters
3. Open the Developer Console (Ctrl/Cmd + Shift + I) to view detailed logs
4. Verify your file matches at least one configured filter

### Position isn't saving

1. Ensure the file is scrollable (content taller than viewport)
2. Check that auto-save delay has elapsed (default: 500ms after stopping scroll)
3. Try the "Save reading position" command manually to test
4. Enable debug logs to see save attempts

### Position restoration isn't working

1. Check that the file has a `reading_progress` value in frontmatter
2. Try the "Restore reading position" command manually
3. Ensure the file content has rendered (plugin waits 150ms for view to stabilize)
4. Check debug logs for restoration attempts

### Invalid percentage values

If you see very large percentages (e.g., 62000%), your frontmatter has invalid values from an earlier version. Simply delete the `reading_progress` field and let the plugin recreate it with the correct format.

## Development

### Building the Plugin

```bash
# Install dependencies
npm install

# Development mode (auto-rebuild on changes)
npm run dev

# Production build
npm run build
```

### Testing Locally

```bash
# Create symlink to your vault's plugins folder
ln -s /path/to/obsidian-reading-progress /path/to/vault/.obsidian/plugins/reading-progress

# Then reload Obsidian (Ctrl/Cmd + R)
```

### Creating a Release

Simply create and push a git tag - the GitHub Actions workflow will automatically:
1. Update `manifest.json` with the tag version
2. Update `versions.json` with compatibility info
3. Build the plugin
4. Create a GitHub release with assets

```bash
git tag 1.0.1
git push origin 1.0.1
```

The workflow ensures the manifest version always matches the git tag.

## Support

Found a bug or have a feature request? Please [open an issue](https://github.com/joch/obsidian-reading-progress/issues).

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Author**: Johnny Chadda
**Repository**: https://github.com/joch/obsidian-reading-progress
