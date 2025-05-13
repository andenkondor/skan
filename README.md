# Skan

> **ℹ️ Info:** This project is heavily inspired by <https://junegunn.github.io/fzf/tips/ripgrep-integration>

A powerful file search and preview tool that integrates with [fzf](https://github.com/junegunn/fzf) and supports [SOPS](https://github.com/mozilla/sops) encrypted files.

## Installation

```bash
brew tap andenkondor/zapfhahn
brew install andenkondor/zapfhahn/skan
```

## Features

- Fast file searching using ripgrep (rg)
- Live preview of file contents with syntax highlighting
- Support for SOPS-encrypted files
- Multi-file selection and batch operations
- Smart handling of multi-word search queries

## Dependencies

- [fzf](https://github.com/junegunn/fzf) - Fuzzy finder
- [ripgrep](https://github.com/BurntSushi/ripgrep) - Fast file search
- [SOPS](https://github.com/mozilla/sops) - Secrets OPerationS
- [bat](https://github.com/sharkdp/bat) - For file previews
- [Neovim](https://neovim.io/) - For file editing

## Usage

```bash
# Basic search
skan

# Search with multi-word query
skan -- "search term with spaces"

# Search in SOPS-encrypted files
skan -s "search term"
```

## Key Bindings

- `Enter` - Open selected file(s)
- `Ctrl-o` - Open selected file(s)
- `Alt-a` - Select all files
- `Alt-d` - Deselect all files
- `Ctrl-/` - Toggle preview window

## How It Works

The script creates a temporary SOPS opener script that allows ripgrep to search through encrypted files. When a file is selected:

1. If it's a SOPS-encrypted file, it will be decrypted before opening
2. If it's a regular file, it will be opened directly
3. Multiple files can be selected and opened in Neovim's quickfix window

## License

MIT
