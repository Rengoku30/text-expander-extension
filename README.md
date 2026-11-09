# Text Expander Extension

An open-source Chrome/Edge Manifest V3 extension that replaces typed triggers with saved snippets in text fields.

Example: type `;addr`, then press Space, Enter, or Tab. The extension replaces it with your saved snippet, such as `123 Main St`.

## Files

- `manifest.json` - MV3 extension manifest
- `match.js` - pure trigger-matching logic (unit tested: `node --test`)
- `content.js` - detects typed triggers and performs replacement
- `options.html` - snippet management UI
- `options.js` - storage, validation, import/export, and UI logic

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.
5. Open the extension options page and add snippets.

## Usage

1. Add a trigger like `;addr`.
2. Add snippet text like `123 Main St`.
3. In a text field, type `;addr`.
4. Press Space, Enter, or Tab to expand. Space keeps a trailing space; Enter and Tab expand only (the key is swallowed, so Enter does not send a chat message).
5. A trigger only expands when it is not glued to a word: `hello;addr` stays as typed, `hello ;addr` expands. Undo (Ctrl+Z) reverts an expansion.

## Error handling included

- Storage read/write failures are caught and shown in the options page.
- Invalid triggers are rejected.
- Import JSON is validated before saving.
- Content-script failures are non-fatal and logged as warnings.
- Read-only, disabled, password, and unsupported input fields are ignored.
- Snippet cache updates when storage changes.

## Known limitations

Complex web editors such as Google Docs, Notion, Slack, and Gmail may use custom DOM/input systems. Basic `contenteditable` fields are supported, but these apps may need editor-specific handling.

## License

MIT
