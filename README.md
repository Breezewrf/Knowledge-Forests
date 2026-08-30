# Knowledge Forests

Knowledge Forests is a desktop Obsidian plugin for manually planting knowledge
seeds, attaching notes to one or more seeds, and visualizing their growth.

Growth is derived from the current heading structure of attached notes. The
default weights are 1 point for each H1 and 0.5 points for each H2.

## Development

```bash
npm install
npm test
npm run build
KNOWLEDGE_FORESTS_VAULT=/path/to/vault npm run deploy
```

The deploy command copies only `main.js`, `manifest.json`, and `styles.css` to
`.obsidian/plugins/knowledge-forests` in the selected vault.

## GitHub authentication

For an HTTPS remote, select **GitHub HTTPS token** and enter a fine-grained
personal access token limited to the notes repository with Contents read/write
permission. The token is stored in Obsidian SecretStorage and is never written
to the vault or remote URL. SSH remotes and system credential helpers remain
available through the **System Git / SSH** authentication mode.

Synchronization always targets the configured `main` branch. If another device
has uploaded overlapping changes, Knowledge Forests pauses the merge and shows
the current-device and remote versions side by side. Text files can be merged
manually; binary files can keep either complete version. Cancelling restores the
local commit with `git merge --abort`.
