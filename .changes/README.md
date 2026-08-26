# Changelog fragments

Every pull request must either add a JSON fragment here or carry the `changelog: skip` label.

Use a short, unique filename such as `.changes/fix-preview-scroll.json`:

```json
{
  "$schema": "./schema.json",
  "type": "fixed",
  "scope": "preview",
  "summary": "Keep the capture preview fixed while the page scrolls",
  "references": ["#123"]
}
```

Describe the result a user can observe, not the implementation. Allowed types are `added`, `changed`, `fixed`, `removed`, and `security`. Set `breaking` to `true` only when users must change how they use DOMShot.

Run `npm run changelog:check` before committing. Release preparation consumes all fragments and writes the versioned section in `CHANGELOG.md`.
