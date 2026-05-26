---
---

No release needed. Switches `ci:publish` to `changeset publish` so the publish step emits the JSON `changesets/action` consumes — without it, GitHub Releases are never created even when npm publishes succeed. Also moves `--access=public` into `.changeset/config.json` and `--provenance` into the `NPM_CONFIG_PROVENANCE` env var, since `changeset publish` doesn't accept those as flags.
