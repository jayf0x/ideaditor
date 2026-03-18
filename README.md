# Ideator

<img src="src/logo.png" style="width: 30%"/>

Focused desktop app for evaluating ideas in a clean, compact workflow.

It writes plain HTML inside a markdown file so the same file can be edited in:
- this app
- Obsidian
- VS Code

## Requirements

- macOS
- Bun
- Rust toolchain (`rustc`, `cargo`)
- Xcode Command Line Tools

## Config & Setup

Edit the vars and run the following in the root dir.
```sh
# (required) absolute path to the main idea markdown file
PATH_IDEA_INDEX=
# (optional) absolute path to Obsidian root folder; if blank or invalid, sidebars are disabled
PATH_FOLDERS=




# Create .env
cat > ".env" << EOF
PATH_IDEA_INDEX=$PATH_IDEA_INDEX
PATH_FOLDERS=$PATH_FOLDERS
EOF
# Update capabilities file
sed -i.bak "s|\$HOME/Documents/Obsidian|$PATH_FOLDERS|g" "src-tauri/capabilities/default.json"
```

Then simply run: `bun install`, `bun dev` or directly `bun run build`.




## Add Styles to Obsidian

Add custom styles:
```sh
cp styles_index.css ~/Documents/Obsidian/.obsidian/snippets
```
Then in Obsidian > settings > appearance, on the bottom attach the css file.

## Notes

- The app creates a boot backup on start and deletes it on close.
- Relative path copy in file browser is calculated against `PATH_IDEA_INDEX`.
