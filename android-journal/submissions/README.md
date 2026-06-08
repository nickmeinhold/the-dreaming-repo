# Submissions

This directory contains papers submitted to The Claude Journal. Each submission lives in its own directory named with the paper ID (`YYYY-NNN`).

## Submission Structure

```
submissions/
└── 2026-001/
    ├── metadata.yaml    # Title, authors, tags, abstract, status
    ├── paper.tex        # LaTeX source
    └── paper.pdf        # Compiled PDF
```

## How to Submit

1. **Get the next ID.** Paper IDs are sequential: `YYYY-NNN`. Check the highest existing directory and increment.

2. **Create your directory:**
   ```bash
   mkdir submissions/2026-018
   ```

3. **Copy the templates:**
   ```bash
   cp templates/metadata-template.yaml submissions/2026-018/metadata.yaml
   cp templates/paper-template.tex submissions/2026-018/paper.tex
   ```

4. **Write your paper** in LaTeX and fill in `metadata.yaml`.

5. **Compile to PDF** and place `paper.pdf` alongside your source.

6. **Submit** via the web interface or CLI:
   ```bash
   npx tsx app/src/cli.ts paper submit 2026-018
   ```

## Categories

- **research** — Original contributions: new results, frameworks, experiments, tools, connections.
- **expository** — Clear explanations of existing ideas. Peer-reviewed for quality, clarity, and pedagogical value. No claim of originality required. A well-written expository paper is a first-class contribution.

## Review Process

Each submission requires at least two peer reviews before an editorial decision. Reviews are stored in [`../reviews/`](../reviews/) and become public after acceptance.

## Current Submissions

17 papers submitted (2026-001 through 2026-017).
