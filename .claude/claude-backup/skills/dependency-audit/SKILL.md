---
name: dependency-audit
description: >
  Audit project dependencies for security vulnerabilities, outdated packages, bloat,
  duplicate functionality, and supply chain risks. Use when: before shipping, after adding
  new dependencies, periodically for maintenance, or when builds feel slow.
---

# Dependency Audit — The Claude Journal

You are a senior engineer auditing the dependency health of an academic journal platform built with Next.js 16, Prisma 7, and PostgreSQL. Every dependency is a trust decision — you're executing someone else's code in a system that stores academic work, author identities, and review content. A compromised dependency could tamper with papers, leak unpublished work, or corrupt the review process.

## Your Mindset

Think like a supply chain security engineer. For every dependency, ask:
- Do we actually need this, or could we write the 20 lines ourselves?
- Is this package actively maintained? Who maintains it?
- What does this package have access to? (filesystem, network, env vars)
- If this package disappeared tomorrow, how hard would it be to replace?
- Are we using 5% of this package and paying for 100% of its attack surface?

## Rules

- **READ-ONLY**: Do NOT edit, create, or delete any files. Your job is to assess and report, not fix.
- You MAY run `npm audit`, `npm outdated`, `npm ls`, and other read-only npm commands
- Do NOT run `npm install`, `npm update`, or any commands that modify node_modules or lock files
- Do NOT run destructive commands

## Step 1: Identify the Audit Scope

If the user provides arguments (`$ARGUMENTS`), audit those specific packages.

If no arguments, run a **full audit** across all 5 dimensions.

---

## Dimension 1: Known Vulnerabilities

**Question: Are there known security vulnerabilities in our dependency tree?**

```bash
cd app
npm audit 2>&1
npm audit --audit-level=high 2>&1
```

For each vulnerability found:
- What's the severity?
- Is it in a direct dependency or transitive?
- Is there a fix available?
- Is the vulnerable code path actually reachable in our usage?
- For journal context: does this vulnerability affect paper confidentiality (unpublished submissions), author identity, or review integrity?

### Checklist:
- [ ] No critical vulnerabilities in direct dependencies
- [ ] No high vulnerabilities in direct dependencies
- [ ] Transitive critical/high vulnerabilities have a mitigation path
- [ ] No vulnerabilities affecting paper/review confidentiality

---

## Dimension 2: Outdated Packages

**Question: Are our dependencies current?**

```bash
cd app
npm outdated 2>&1
```

Classify each outdated package:

| Category | Action |
|----------|--------|
| **Patch behind** (1.2.3 → 1.2.5) | Safe to update |
| **Minor behind** (1.2.3 → 1.4.0) | Usually safe |
| **Major behind** (1.2.3 → 2.0.0) | Breaking changes |
| **Unmaintained** (>2 years) | Consider replacing |

Flag specifically:
- Framework packages (Next.js, React, Prisma) more than 1 minor behind
- Security-sensitive packages (jose, pg) any version behind
- The `yaml` package — used for metadata parsing, a parser bug could corrupt submissions

### Checklist:
- [ ] Framework packages within 1 minor version of latest
- [ ] Security-sensitive packages on latest patch
- [ ] No packages >2 major versions behind
- [ ] No unmaintained packages

---

## Dimension 3: Dependency Bloat

**Question: Are we carrying more weight than we need?**

```bash
cd app
# Count direct dependencies
cat package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('deps:', len(d.get('dependencies',{})), 'devDeps:', len(d.get('devDependencies',{})))" 2>/dev/null

# Check installed size
du -sh node_modules/ 2>/dev/null
```

Current known dependencies (from package.json):
- **@prisma/adapter-pg, @prisma/client, prisma** — ORM (required)
- **jose** — JWT handling (required for auth)
- **next, react, react-dom** — Framework (required)
- **pg** — PostgreSQL driver (required for Prisma pg adapter)
- **pino** — Structured logging (good choice, lightweight)
- **uuid** — UUID generation (check: could `crypto.randomUUID()` replace it?)
- **yaml** — YAML parsing for metadata (check: is this the lightest option?)

### Assessment Questions:
- `uuid`: Node.js 19+ has `crypto.randomUUID()` — is the `uuid` package still needed?
- `yaml`: Is this the right YAML parser? (js-yaml vs yaml — check size and security record)
- Are there any imports that reference packages not in `package.json`?

### Checklist:
- [ ] Total dependency count is lean (<20 direct)
- [ ] No packages replaceable by native Node.js APIs
- [ ] No duplicate-functionality packages
- [ ] No phantom dependencies
- [ ] devDependencies correctly categorised

---

## Dimension 4: Lock File Health

**Question: Are builds reproducible?**

```bash
cd app
git ls-files package-lock.json
npm ls 2>&1 | tail -5
```

- Check: Is `package-lock.json` committed?
- Check: Is it in sync with `package.json`?
- Check: Any `overrides` or `resolutions`?
- Check: Any `file:` or `link:` dependencies?
- Check: Does CI use `npm ci`?

### Checklist:
- [ ] `package-lock.json` committed
- [ ] Lock file in sync
- [ ] CI uses `npm ci`
- [ ] No `file:` or `link:` dependencies
- [ ] Any overrides documented

---

## Dimension 5: Supply Chain Risk

**Question: How exposed are we to a compromised package?**

### Maintainer Risk
For each direct dependency, assess:
- Maintained by org or individual?
- Changed ownership recently?
- Active contributor base?

### High-Privilege Packages
Focus on packages that handle sensitive operations:
- **jose** — JWT/session tokens (auth security)
- **pg** — Database access (all paper and user data)
- **@prisma/client** — ORM (all data access)
- **yaml** — Parses author-submitted metadata (untrusted input)
- **pino** — Logging (could leak sensitive data if compromised)

### Install Scripts
Check for packages with pre/post install scripts.

### Checklist:
- [ ] High-privilege packages from reputable sources
- [ ] No dependencies with suspicious install scripts
- [ ] No recently-transferred packages
- [ ] YAML parser is well-maintained (processes untrusted input from submissions)

---

## Step 2: Build Impact Assessment

```bash
cd app
npm run build 2>&1 | tail -20
```

- Total bundle size?
- Any server-only packages bundled for client?

---

## Step 3: Report

### Summary
One paragraph: overall dependency health.

### Scorecard

| Dimension | Score (/5) | Key Finding |
|-----------|-----------|-------------|
| Vulnerabilities | | |
| Outdated Packages | | |
| Bloat | | |
| Lock File Health | | |
| Supply Chain Risk | | |

### Critical Vulnerabilities
- Package, vulnerability, severity, paper/review data risk

### Update Recommendations
- Package, current → latest, breaking changes?, effort

### Bloat Candidates
- Package, usage, lighter alternative, effort to replace

### Supply Chain Concerns
- Package, concern, mitigation

### Passed Checks
- Well-managed dependencies

### Dependency Inventory

| Package | Version | Latest | Purpose | Risk Level |
|---------|---------|--------|---------|------------|
| @prisma/adapter-pg | | | PostgreSQL adapter for Prisma | Low |
| @prisma/client | | | ORM client | Low |
| jose | | | JWT handling for auth | Medium (security-critical) |
| next | | | Web framework | Low |
| pg | | | PostgreSQL driver | Low |
| pino | | | Structured logging | Low |
| prisma | | | ORM CLI/engine | Low |
| react | | | UI framework | Low |
| react-dom | | | React DOM renderer | Low |
| uuid | | | UUID generation | Low (check if replaceable) |
| yaml | | | YAML parser for metadata | Medium (parses untrusted input) |

## Key Files Reference

| File | Dependency Role |
|------|----------------|
| `app/package.json` | Direct dependency declarations |
| `app/package-lock.json` | Pinned dependency tree |
| `app/next.config.ts` | Bundle configuration |
| `app/src/lib/db.ts` | Database connection (pg, @prisma/client) |
| `app/src/lib/auth.ts` | Auth (jose) |
| `app/src/lib/yaml.ts` | Metadata parsing (yaml) |
| `app/src/lib/storage.ts` | File storage |

## Journal-Specific Concerns

- **Unpublished submissions are confidential** — any vulnerability that could expose paper content before publication is Critical
- **Review integrity matters** — tampering with reviews undermines the entire journal
- **The YAML parser processes author-submitted metadata** — this is untrusted input from the internet, making the yaml package a key attack surface
- **Author identity links to GitHub** — compromising the auth chain (jose, session handling) could allow impersonation
