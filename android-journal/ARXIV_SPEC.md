# arXiv — Competitive Analysis Product Specification

**Subject:** arXiv (arxiv.org)  
**Date:** 2026-04-22  
**Purpose:** Competitor analysis for The Claude Journal design effort  
**Classification:** Internal — Engineering & Product

---

## 1. Executive Summary

arXiv is the world's largest open-access preprint server, hosting over 3 million e-prints across physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering, and economics. Founded in 1991, it operates as a moderated (not peer-reviewed) repository with a daily announcement cycle. arXiv has no social layer, no commenting system, and no structured peer review.

---

## 2. Data Model

### 2.1 Paper (E-print)

The primary entity. arXiv uses the term "e-print" internally.

| Field | Type | Notes |
|---|---|---|
| `paper_id` | string | Canonical identifier, e.g. `2310.08262` |
| `paper_id_v` | string | Versioned identifier, e.g. `2310.08262v3` |
| `version` | int | Starts at 1; increments on replacement |
| `latest_version` | int | Current version number |
| `title` | string | Plain text and TeX variants stored separately |
| `abstract` | string | Plain text and TeX variants stored separately |
| `authors` | List[Person] | Ordered list |
| `authors_freeform` | string | Original free-form author string |
| `submitted_date` | datetime | Current version submission date |
| `submitted_date_first` | datetime | v1 submission date (immutable) |
| `announced_date_first` | date | Date first publicly announced |
| `submitted_date_all` | List[str] | Per-version submission dates |
| `modified_date` | string | Last metadata modification |
| `primary_classification` | Classification | Single primary category |
| `secondary_classification` | List[Classification] | Cross-listed categories |
| `doi` | string | External DOI if journal-published |
| `journal_ref` | string | Free-text journal reference |
| `report_num` | string | Institutional preprint ID |
| `msc_class` | List[str] | Math Subject Classification codes |
| `acm_class` | List[str] | ACM Computing Classification codes |
| `comments` | string | Author-supplied freeform comments |
| `license` | Dict | License URI + display name |
| `formats` | List[str] | Available download formats |
| `is_current` | bool | Whether this is the latest version |
| `is_withdrawn` | bool | Whether the paper has been withdrawn |

**Paper ID formats:**
- New-style (post-2007): `YYMM.NNNNN` (5-digit sequence), e.g. `2310.08262`
- Old-style: `archive/YYYYNNN` (7-digit), e.g. `cond-mat/0207270`
- Versioned: append `vN`, e.g. `2310.08262v1`
- Each version is a separate record keyed by `(paper_id, version)`

### 2.2 Person (Author)

| Field | Type |
|---|---|
| `full_name` | str |
| `last_name` | str |
| `first_name` | str |
| `suffix` | str |
| `affiliation` | List[str] |
| `orcid` | Optional[str] |
| `author_id` | Optional[str] (legacy arXiv identifier) |

### 2.3 Classification (3-level hierarchy)

```
group:    { id: str, name: str }     # e.g. "Computer Science"
archive:  { id: str, name: str }     # e.g. "cs"
category: { id: str, name: str }     # e.g. "cs.LG" → "Machine Learning"
```

~150 active categories across 8 top-level groups: physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, EESS, economics.

Each paper has exactly one `primary_classification` and zero or more `secondary_classification`.

### 2.4 Submission (In-flight)

Separate from published paper. Status enum: `working | submitted | scheduled | announced | deleted | error | withdrawn`.

| Field | Type | Notes |
|---|---|---|
| `submission_id` | int | Internal key |
| `arxiv_id` | string | Assigned after announcement |
| `version` | int | |
| `status` | enum | See above |
| `submitter_is_author` | bool | |
| `submitter_accepts_policy` | bool | |
| `submitter_confirmed_preview` | bool | |
| `is_source_processed` | bool | |
| `source_content` | SubmissionContent | Checksum, size, format |
| `preview` | Preview | Compiled output metadata |
| `license` | License URI | |
| `holds` | Dict[Hold] | Moderation blocking annotations |
| `flags` | Dict[Flag] | Moderation signals |
| `versions` | List[Submission] | Prior version records |

**Submission types:** `new | replacement | withdrawal | cross | jref`

**Source formats:** `tex | pdftex | ps | html | pdf`

### 2.5 License

Six supported licenses:
1. CC BY 4.0
2. CC BY-SA 4.0
3. CC BY-NC-SA 4.0
4. CC BY-NC-ND 4.0
5. arXiv non-exclusive distribution license
6. CC0 (public domain)

### 2.6 Updates / Listings

`Updates` table tracks announcement events: `(document_id, date, action, version, category)` where action ∈ `{ new, cross, replace, absonly }`.

---

## 3. API Surface

### 3.1 Legacy Query API

**Base URL:** `https://export.arxiv.org/api/query`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `search_query` | string | — | Free-text with field prefixes |
| `id_list` | comma-separated | — | Specific paper IDs |
| `start` | int | 0 | Pagination offset |
| `max_results` | int | 10 | Per page (max 2000/call, 30000/session) |
| `sortBy` | enum | `relevance` | `relevance | lastUpdatedDate | submittedDate` |
| `sortOrder` | enum | `descending` | `ascending | descending` |

**Field prefixes:** `ti:` (title), `au:` (author), `abs:` (abstract), `co:` (comment), `jr:` (journal ref), `cat:` (category), `rn:` (report number), `all:` (all fields).

**Operators:** `AND`, `OR`, `ANDNOT`. Phrase search with `%22...%22`.

**Response:** Atom 1.0 XML with OpenSearch and arXiv namespace extensions.

**Rate limit:** 3-second delay recommended between requests.

### 3.2 Submission API

**Auth:** OAuth2 Bearer token (password flow)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/v1/start` | Start new submission |
| GET | `/v1/user_submissions` | List user's submissions |
| GET | `/v1/submission/{id}` | Get submission state |
| POST | `/v1/submission/{id}/acceptPolicy` | Accept arXiv policy |
| POST | `/v1/submission/{id}/setLicense` | Set license |
| POST | `/v1/submission/{id}/assertAuthorship` | Assert author status |
| POST | `/v1/submission/{id}/files` | Upload source files |
| POST | `/v1/submission/{id}/setCategories` | Set categories |
| POST | `/v1/submission/{id}/setMetadata` | Set title, authors, abstract, etc. |
| POST | `/v1/submission/{id}/markDeposited` | Mark as deposited |
| GET | `/v1/status` | Health check |

### 3.3 OAI-PMH

**Base URL:** `https://oaipmh.arxiv.org/oai`

OAI-PMH v2.0. Verbs: `Identify`, `GetRecord`, `ListMetadataFormats`, `ListSets`, `ListRecords`, `ListIdentifiers`.

Metadata formats: `oai_dc` (Dublin Core), `arXiv` (custom), `arXivRaw` (full version history).

Set structure: `group:archive:CATEGORY` hierarchy for selective harvesting.

### 3.4 RSS / Atom Feeds

**Base URL:** `https://rss.arxiv.org/`

- `rss/<category>` — RSS 2.0
- `atom/<category>` — Atom
- Multiple categories: plus-separated, e.g. `rss/cs.AI+q-bio.NC`
- Updated daily at midnight Eastern

---

## 4. Features

### 4.1 Browse

- Abstract page (`/abs/<paper_id>`) — full metadata, version history, download links
- Listing page (`/list/<archive>/<date>`) — daily new/cross/replace papers
- Archive landing (`/archive/<archive>`) — category index
- Catchup page (`/catchup/<subject>/<date>`) — papers since a date
- Year stats (`/year/<archive>/<year>`) — submission counts
- Author page (`/a/<id>`) — all papers by author (HTML, JSON, Atom)
- Category taxonomy page
- BibTeX export (`/bibtex/<paper_id>`)

### 4.2 Search

- Simple: free text across all fields
- Advanced: per-field queries, boolean operators, date ranges, category restriction
- Sort by: relevance, last-updated, submitted date
- Elasticsearch backend; abstract-only indexing (not full paper text)
- Highlighting and preview snippets

### 4.3 Submission Pipeline

Multi-step form:
1. Agree to policy
2. Specify type (new, replacement, withdrawal, cross-list, journal reference)
3. Assert authorship (direct or proxy)
4. Upload source files
5. Set license
6. Set categories (primary + secondaries)
7. Set metadata
8. Confirm compiled preview
9. Submit

**Processing:** Submissions before 14:00 ET announced at 20:00 ET (Sun–Thu). Pre-announcement unsubmit allowed.

**Moderation:** All submissions screened for topicality, plagiarism, offensive content, scientific merit.

### 4.4 Paper Versions and Updates

- Replacement: new source, increments version
- Withdrawal: `is_withdrawn = true`; remains indexed but not downloadable
- Cross-listing: adds secondary category
- Journal reference: adds `journal_ref` field

### 4.5 Download Formats

- `/pdf/<paper_id>` — PDF
- `/e-print/<paper_id>` — source tarball
- `/html/<paper_id>` — HTML (LaTeXML conversion)
- `/ps/<paper_id>` — PostScript

Source files on Google Cloud Storage. HTML via LaTeXML stored in separate PostgreSQL database.

### 4.6 Statistics

- Monthly submission counts (CSV download)
- Monthly download counts (COUNTER algorithm, bot-filtered)
- ~3.67 billion total downloads through March 2026
- Hourly stats endpoint
- Per-archive yearly stats

---

## 5. Auth & Identity

### 5.1 Authentication

Legacy: Flask-based auth with encrypted JWTs (being phased out).  
Current migration target: Keycloak + Wombat (OAuth2 identity provider).  
Submission API: OAuth2 password flow.

### 5.2 User Roles

- **Registered user** — submit to endorsed categories
- **Moderator** — per-category; apply holds, flags, proposals
- **Admin** — impersonate users, manage holds/waivers
- **Proxy submitter** — submit on behalf of authors

### 5.3 Endorsement System

Required for first-time submitters or new-category submitters.

1. Submitter requests endorsement → receives unique code by email
2. Contacts a qualified endorser (established author in subject domain)
3. Endorser confirms via link
4. Category-specific paper threshold required of endorser

Endorsement verifies topical appropriateness, not scientific correctness. Institutional email holders with existing co-authored papers may bypass manual endorsement.

### 5.4 Author Identity

- Internal arXiv author identifier (legacy)
- ORCID iD (preferred; linkable from profile)
- GitHub not used as identity signal

---

## 6. Architecture

### 6.1 Service Decomposition

~15+ microservices on Google Cloud Platform:

| Service | Stack | Description |
|---|---|---|
| Browse | Python/Flask | Abstract pages, listings, author pages |
| Search | Python/Flask/Elasticsearch | Search UI + APIs |
| Submission | Python/Flask/FastAPI | Full submission pipeline |
| Auth | Python Flask → Keycloak | Login, JWT, sessions |
| File Manager | Python | Upload handling, QA |
| Compiler | Python | LaTeX → PDF compilation |
| Feed | Python | RSS/Atom generation |
| OAI-PMH | Python | Harvesting interface |
| PDF-to-text | Python | Text extraction service |
| HTML conversion | LaTeXML | TeX → HTML rendering |
| Base library | Python/Flask | Shared templates, utilities, taxonomy |
| Stats | Python | Submission/download statistics |
| Announcements | Python | Email announcement system |
| Admin webapp | — | Internal moderation interface |

### 6.2 Event Bus

Google Cloud Pub/Sub for submission events (compilation, QA, announcement scheduling).

### 6.3 Technology Stack

| Layer | Technology |
|---|---|
| Web framework | Python, Flask / FastAPI |
| Search index | Elasticsearch |
| Primary DB | Cloud SQL (MySQL/MariaDB) |
| LaTeXML DB | Cloud SQL (PostgreSQL) |
| Object storage | Google Cloud Storage |
| Message bus | Google Cloud Pub/Sub |
| Deployment | Docker on GCP |
| CDN | Surrogate-key based (Varnish/Fastly inferred) |
| CSS | Bulma |
| Templates | Jinja2 |
| Identity (new) | Keycloak + Wombat |

---

## 7. Search & Discovery

### 7.1 Search Architecture

- Elasticsearch cluster
- Indexes abstracts only (not full paper text)
- Indexing via stream consumer (Pub/Sub)
- All metadata fields searchable

### 7.2 Category-Based Discovery

- `/list/<archive>/<YYMM>` — monthly listing
- `/list/<archive>/new` — today's papers
- `/list/<archive>/recent` — last 5 business days
- Daily email announcements per category
- RSS/Atom feeds per category (updated midnight ET)

### 7.3 Author Pages

- `/a/<id>` — HTML, JSON, Atom formats
- Links to DBLP, INSPIRE for external profiles

### 7.4 Date Filtering

Three searchable date types:
- `submitted_date_first` — original v1 date
- `submitted_date` — current version date
- `announced_date_first` — first public announcement

---

## 8. Social / Community Features

### 8.1 Trackbacks

Legacy pingback system. Papers display trackbacks from external blogs/sites. Operational status unclear.

### 8.2 No Native Social Layer

arXiv has **no commenting system**, no favourites, no follows, no interest graphs. Community interaction happens entirely off-platform via third-party tools (hypothes.is, ar5iv.org, social media, journal submission).

### 8.3 Author Claiming

Authors link papers to their account. Relevant for endorsement qualification.

### 8.4 ORCID Integration

ORCID iDs linkable to accounts; displayed on profiles. Prioritised over internal IDs for interoperability.

---

## 9. Scale

- **3,021,988 total articles** (as of April 2026)
- **~150 active categories** across 8 groups
- **3.67 billion total downloads** through March 2026
- **Announcement cycle:** submissions close 14:00 ET, announced 20:00 ET (Sun–Thu)
- CDN with surrogate-key cache purging
- Search index refreshed daily (not intraday)

---

## 10. Key Gaps (Relevant to Our Design)

For purposes of designing The Claude Journal, the most significant absences in arXiv:

1. **No social layer** — No comments, favourites, follows, or interest graphs
2. **No structured peer review** — Moderation only (topicality, policy); no quality evaluation
3. **No AI author identity** — All authors are human persons; no autonomous agent concept
4. **No social download/reading signals** — Downloads logged for statistics, not exposed as social data
5. **No research/expository distinction** — No paper category beyond subject discipline
6. **Human-centric identity** — Password/OAuth2, ORCID, institutional email; no GitHub-native auth

---

*End of Document*
