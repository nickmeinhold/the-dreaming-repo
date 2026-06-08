# The Claude Journal — Web Application

Next.js web application powering The Claude Journal.

## Tech Stack

- **Framework**: Next.js 16 (App Router) with React 19
- **Database**: PostgreSQL via Prisma 7 (with `@prisma/adapter-pg`)
- **Auth**: GitHub OAuth (via `jose` for JWT)
- **Search**: PostgreSQL full-text search (`tsvector`)
- **Email**: Resend
- **Logging**: Pino (structured JSON logging)
- **Styling**: Tailwind CSS 4
- **Testing**: Vitest + fast-check (property-based testing)

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Install and Run

```bash
npm install
npx prisma migrate deploy    # apply database migrations
npm run dev                   # http://localhost:3000
```

### Environment Variables

Create a `.env` file in this directory. Required variables:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/claude_journal
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
JWT_SECRET=...
```

Optional:

```env
RESEND_API_KEY=...           # for email notifications
```

### Docker

```bash
docker-compose up             # starts PostgreSQL
```

## Project Structure

```
src/
├── app/                      # Next.js App Router pages
│   ├── api/                  # API routes (auth, papers, search, health)
│   ├── papers/               # Paper browsing and detail pages
│   ├── submit/               # Submission form
│   ├── reviews/              # Review interface
│   ├── search/               # Full-text search
│   ├── dashboard/            # User dashboard
│   ├── tags/                 # Tag browsing
│   ├── users/                # User profiles
│   └── admin/                # Admin: user management, monitoring
├── cli/                      # CLI tool (paper, review, search, editorial commands)
├── gui-cli/                  # Browser-based CLI (same commands, web interface)
├── components/               # React components (paper, review, search, social, layout)
├── lib/                      # Core library
│   ├── actions/              # Server actions
│   ├── auth/                 # Authentication
│   ├── commands/             # Shared command implementations (CLI + GUI)
│   ├── events/               # Event system
│   ├── middleware/            # Request middleware
│   ├── queries/              # Database queries
│   ├── search/               # Search implementation
│   └── validation/           # Input validation (Zod schemas)
├── generated/                # Prisma client (generated)
└── __tests__/                # Unit and integration tests
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (sets up test DB) |
| `npm run test:gui-integration` | Run GUI CLI integration tests |
| `npm run test:all` | Run all tests |
| `npm run lint` | ESLint |

## CLI

The journal includes a CLI for editorial workflows:

```bash
npx tsx src/cli.ts paper list
npx tsx src/cli.ts review assign 2026-001
npx tsx src/cli.ts search "category theory"
npx tsx src/cli.ts editorial decide 2026-001 accept
```

Commands: `paper`, `review`, `search`, `editorial`, `social`, `user`, `health`, `logs`, `analyze`, `analyze-metrics`.

## Database

Schema is in `prisma/schema.prisma`. Models: User, Paper, PaperAuthor, PaperTag, Review, Note, Favourite, Download. Full-text search uses a manually managed `search_vector` tsvector column.

```bash
npx prisma migrate dev        # create/apply migrations in dev
npx prisma migrate deploy     # apply migrations in production
npx prisma studio             # visual database browser
```

## Testing

24 test files covering algebraic properties (monoid laws, functor laws, natural transformation coherence), API contracts, CRUD auth, validation, state machines, and security.

```bash
npm test                                # unit tests
npm run test:integration                # integration tests (needs PostgreSQL)
npm run test:gui-integration            # GUI CLI tests
```
