# Knowledge Forests

Knowledge Forests is a desktop [Obsidian](https://obsidian.md/) plugin that turns deliberate learning into a visual forest.

You manually plant a **Seed** for a topic, attach existing notes to it, and watch the plant grow as the structure of those notes develops. Related Seeds can be classified into **Forests**, while a GitHub-style activity view shows your commit history.

> Knowledge Forests never creates Seeds automatically. You decide what is worth planting and how notes are organized.

## Features

- **Manual Seeds** — capture an idea without having the plugin infer topics for you.
- **Content-driven growth** — attached-note headings determine the plant's current stage.
- **Multiple membership** — one note can support multiple Seeds.
- **Forest classification** — drag Seeds between clear visual Forest groups or return them to Unassigned.
- **Five SVG growth stages** — Seed, Sprout, Seedling, Young Tree, and Mature Tree.
- **Responsive activity heatmap** — switch between 30, 90, 180, and 365 days with buttons or `Ctrl/Cmd + wheel`.
- **GitHub synchronization** — save local changes, merge remote `main`, and upload through one Sync action.
- **Multi-device conflict resolution** — compare current-device and remote versions, keep either side, or merge text manually.
- **Remote update notification** — checks when Obsidian regains focus and every five minutes without changing local files.

## Requirements

- Obsidian **1.11.4 or later**
- Windows, macOS, or Linux desktop
- Git available on `PATH`
- A GitHub repository when using cloud synchronization

Mobile Obsidian is not currently supported because Knowledge Forests uses the system Git executable.

## Installation

Knowledge Forests is not yet listed in the Obsidian Community Plugins directory. Build and install it manually:

```bash
git clone https://github.com/Breezewrf/Knowledge-Forests.git
cd Knowledge-Forests
npm install
npm run build
```

Copy these files into `<your-vault>/.obsidian/plugins/knowledge-forests/`:

```text
main.js
manifest.json
styles.css
```

Restart Obsidian, open **Settings → Community plugins**, and enable **Knowledge Forests**.

## Quick start

1. Open Knowledge Forests from the tree icon in the Obsidian ribbon.
2. Select **Sow seed** and give the topic a name.
3. In the Files view, right-click a note and select **Manage seeds**.
4. Open Forests, create a Forest, and drag Seeds into it.
5. Open Seeds to review each plant's score and attached notes.

Knowledge Forests stores its records as ordinary Markdown:

```yaml
---
forest-kind: seed
forest-id: "stable-uuid"
forests:
  - "[[Knowledge Forests/Forests/Distributed Systems]]"
---
```

An attached note uses a portable Wikilink property:

```yaml
---
seeds:
  - "[[Knowledge Forests/Seeds/DDS]]"
  - "[[Knowledge Forests/Seeds/ROS 2]]"
---
```

Disabling the plugin does not make this data unreadable or lock it into a proprietary database.

## Growth model

Growth is recalculated from the current headings in explicitly attached notes:

| Heading | Default points |
| --- | ---: |
| H1 | 1 |
| H2 | 0.5 |
| H3–H6 | 0 |

Default stages:

| Score | Stage |
| ---: | --- |
| 0 | Seed |
| 0.5–4.5 | Sprout |
| 5–14.5 | Seedling |
| 15–39.5 | Young Tree |
| 40+ | Mature Tree |

Weights and thresholds are configurable. Removing headings can reduce the score because the plant represents the current structure of your knowledge, not a permanent achievement counter.

## GitHub sync

Knowledge Forests always synchronizes the `main` branch. A Sync action performs three user-facing steps:

```text
Save local changes → Merge remote updates → Upload
```

The status panel reports **Synced**, **Local changes**, **Remote updates available**, **Syncing**, or **Conflict**. Non-overlapping changes from different devices merge automatically.

If two devices edit overlapping content, synchronization pauses and opens a resolver:

- Text files: keep the current device, keep the remote version, or edit a combined result.
- Binary files: keep one complete version.
- Deleted/modified files: keep the remaining version or accept deletion.
- Cancel: run `git merge --abort` and preserve the local commit.

No conflict result is uploaded until every conflicted file has been resolved.

### Authentication

For an HTTPS GitHub remote:

1. Create a fine-grained personal access token restricted to the notes repository.
2. Grant **Contents: Read and write** permission.
3. Select **GitHub HTTPS token** in Knowledge Forests settings.
4. Paste the token into the password field.

The token is kept in Obsidian `SecretStorage`. It is never written to the Vault, Git remote URL, plugin `data.json`, logs, or command arguments. During fetch and push, Git receives it through a temporary AskPass environment that is removed afterward.

SSH remotes and operating-system credential helpers are supported through **System Git / SSH** mode.

## Activity

Activity counts commits on `main` whose author email matches the email configured in Knowledge Forests. The heatmap supports:

- 30, 90, 180, or 365 days
- responsive cells that fit the available sidebar width
- month labels
- click-to-view commit summaries
- zoom buttons and `Ctrl/Cmd + mouse wheel` or trackpad pinch

Commit counts reflect deliberate Sync operations rather than every editor save.

## Development

```bash
npm install
npm test
npm run build
```

The test suite includes a two-device Git scenario in temporary repositories: both devices edit the same line, one pushes first, the other detects a conflict, resolves it, and uploads the merged history.

To build and deploy directly to a local test Vault:

```bash
KNOWLEDGE_FORESTS_VAULT=/path/to/vault npm run deploy
```

The deploy command copies only `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/knowledge-forests/`.

## Roadmap

- [ ] More detailed conflict diffs and merge assistance
- [ ] Additional plant themes
- [ ] Three.js forest renderer using the existing renderer abstraction
- [ ] Mobile-compatible synchronization research
- [ ] Docker release version
- [ ] ...

## Security and data safety

- Use a private GitHub repository for personal notes.
- A private repository controls access but does not provide end-to-end encryption.
- Do not store passwords, private keys, or unrelated secrets in the Vault.
- Keep an independent backup when first enabling synchronization.
- Knowledge Forests does not automatically choose a winner during a content conflict.

## License

[MIT](LICENSE)
