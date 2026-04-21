# Gang of Four — All 23 Patterns

Applied to The Claude Journal codebase. Each pattern includes: the GoF description,
its status in this project, and where/whether it should be applied.

Where relevant, the category-theoretic interpretation is noted — see `CATEGORIES.md`
for the full CT analysis.

---

## Creational Patterns (5)

### 1. Abstract Factory
> Provide an interface for creating families of related objects without specifying
> their concrete classes.

**Status: Not applied. Not needed.**

The codebase creates Prisma records directly. An abstract factory would make sense if
we needed to swap between storage backends (PostgreSQL vs SQLite for testing, or a
mock layer). Currently, Prisma handles this via its adapter pattern (`PrismaPg`),
which is itself an abstract factory in spirit.

**Should apply?** Only if we add a test suite that needs an in-memory database.
Prisma's adapter system already provides this capability.

### 2. Builder ✅
> Separate the construction of a complex object from its representation so that
> the same construction process can create different representations.

**Status: Applied.** `RouteBuilder<Ctx>` (`middleware/builder.ts:15–60`).

The fluent `.use().use().handle()` API is a textbook Builder. Each `.use()` call
adds a construction step (a Kleisli arrow), and `.handle()` finalises the object
(a `RouteHandler`). The Builder accumulates middleware and the final product is
a composed async function.

The pre-composed stacks (`stacks.ts`) are partially-applied Builders — construction
steps frozen at specific intermediate points.

**CT interpretation:** The Builder is a monoid in the category of Kleisli arrows.

### 3. Factory Method ✅
> Define an interface for creating an object, but let subclasses decide which class
> to instantiate.

**Status: Applied.** `stacks.ts` — `publicRoute()`, `authRoute()`, `editorRoute()`,
`adminRoute()` are factory functions that produce pre-configured `RouteBuilder`
instances. Each factory decides which middleware to include.

Also: `createPrismaClient()` in `db.ts:6–12` is a factory method for the Prisma client.

**Should apply more?** Yes — paper creation. `submitPaper()` (`actions/papers.ts`) does
validation, ID generation, record creation, file storage, and path update in one
monolithic function. A factory method for paper creation would separate the "what" from
the "how":

```typescript
// Factory method: paper creation
function createPaper(validated: ValidatedSubmission): Promise<Paper>
// Factory method: review creation
function createReview(validated: ValidatedReview): Promise<Review>
```

### 4. Prototype
> Specify the kinds of objects to create using a prototypical instance, and create
> new objects by copying this prototype.

**Status: Not applied. Not needed.**

No cloning or template-based object creation in the current codebase. Would apply if
we had "paper templates" (e.g., clone a paper's metadata to create a revision).

**Should apply?** Potentially for paper revisions — when a paper goes to "revision"
status, the author might want to submit a new version based on the original metadata.
A prototype pattern would clone the paper record and bump a version number.

### 5. Singleton ✅
> Ensure a class has only one instance and provide a global point of access to it.

**Status: Applied.** `db.ts:4,14–21`.

The Prisma client uses `globalThis` caching with a `Proxy` wrapper for lazy
initialization. This ensures exactly one `PrismaClient` instance survives Next.js
HMR in development (where module re-evaluation would otherwise create connection leaks).

**CT interpretation:** A terminal object — there's exactly one morphism from any
module to the Prisma singleton.

---

## Structural Patterns (7)

### 6. Adapter
> Convert the interface of a class into another interface clients expect. Adapter
> lets classes work together that couldn't otherwise because of incompatible interfaces.

**Status: Not applied explicitly, but implicit in several places.**

- GitHub OAuth: The callback route (`api/auth/github/callback`) adapts the GitHub user
  object into the Journal's `User` model via `prisma.user.upsert()`.
- Paper metadata: `storePaperFiles()` adapts domain fields into a YAML structure that
  the `/peer-review` Claude Code skill expects.

**Should apply?** Yes — extract an explicit adapter for GitHub → User mapping. Currently
the adapter logic is inline in the OAuth callback. If we add more auth providers
(GitLab, email), each would need its own adapter:

```typescript
interface AuthAdapter {
  exchangeCode(code: string): Promise<ExternalUser>;
  toJournalUser(external: ExternalUser): UpsertData;
}
```

**CT interpretation:** An adapter is a natural transformation between functors (see
CATEGORIES.md §7).

### 7. Bridge
> Decouple an abstraction from its implementation so that the two can vary independently.

**Status: Not applied. Partially applicable.**

The Bridge pattern would be useful for **search**: the search abstraction (query → results)
could be backed by different implementations (PostgreSQL tsvector today, Elasticsearch
or Typesense later, or even a vector/semantic search). Currently `search.ts` is
tightly coupled to Postgres `$queryRawUnsafe`.

**Should apply?** Yes, if search needs to evolve. Define a `SearchEngine` interface:
```typescript
interface SearchEngine {
  search(query: string, opts: SearchOptions): Promise<SearchResults>;
}
```
Then `PostgresSearchEngine` implements it with tsvector, and future engines can be
swapped in.

### 8. Composite
> Compose objects into tree structures to represent part-whole hierarchies. Composite
> lets clients treat individual objects and compositions of objects uniformly.

**Status: Not applied explicitly, but the domain has composites.**

Note threads are a tree: each `Note` has an optional `parentId`, forming a forest.
The rendering in `note-thread.tsx` handles this recursively. However, there's no
domain-level composite abstraction — the tree is reconstructed from flat database
rows each time.

**Should apply?** Consider when note operations grow. A `NoteTree` composite that
supports operations like "count all replies," "flatten to list," "find deepest thread"
would be cleaner than ad hoc recursive queries.

**CT interpretation:** Composites are initial F-algebras (see CATEGORIES.md §18).

### 9. Decorator
> Attach additional responsibilities to an object dynamically. Decorators provide a
> flexible alternative to subclassing for extending functionality.

**Status: Applied (as middleware).** Each `.use()` call in `RouteBuilder` decorates
the route handler with additional behaviour (tracing, authentication, authorization).
Middleware *is* the Decorator pattern — each layer wraps the next, adding responsibility
while preserving the core interface.

**Should apply more?** Could apply to:
- **Paper rendering**: Decorate PDF responses with watermarks, download headers, or
  usage tracking without modifying the core download logic.
- **Server actions**: Wrap actions with logging, rate limiting, or input sanitization
  decorators. This connects to CATEGORIES.md §13 (distributive laws for composing effects).

### 10. Facade ✅
> Provide a unified interface to a set of interfaces in a subsystem. Facade defines
> a higher-level interface that makes the subsystem easier to use.

**Status: Applied.** Server Actions (`actions/papers.ts`, `actions/social.ts`,
`actions/editorial.ts`, `actions/reviews.ts`) are facades over the database, file
system, and auth subsystems. Client components call `submitPaper(formData)` without
knowing about Prisma transactions, file storage, or paper ID generation.

The pre-composed middleware stacks (`stacks.ts`) are also facades: `authRoute()` hides
the details of trace + session middleware behind a single call.

### 11. Flyweight
> Use sharing to support large numbers of fine-grained objects efficiently.

**Status: Not applied. Not needed.**

No fine-grained object sharing required. Tags might qualify — they're shared across
papers via a join table — but Prisma handles this naturally with `upsert`.

**Should apply?** No. The domain doesn't have enough repeated fine-grained objects
to warrant Flyweight.

### 12. Proxy ✅
> Provide a surrogate or placeholder for another object to control access to it.

**Status: Applied.** `db.ts:14–21` uses a JavaScript `Proxy` to lazily initialize the
Prisma client. The proxy intercepts all property access and delegates to the real
client, creating it on first use.

This is a **virtual proxy** (delays creation) combined with **protection proxy**
(throws if `DATABASE_URL` is missing).

---

## Behavioral Patterns (11)

### 13. Chain of Responsibility ✅
> Avoid coupling the sender of a request to its receiver by giving more than one object
> a chance to handle the request. Chain the receiving objects and pass the request along
> the chain until an object handles it.

**Status: Applied.** The middleware pipeline (`builder.ts:43–46`):

```typescript
for (const mw of mws) {
  const result = await mw(ctx);
  if (result instanceof NextResponse) return result;
  ctx = result;
}
```

Each middleware can either handle the request (return `NextResponse`) or pass it along
(return enriched context). `withRole` short-circuits with 403; `withSession`
short-circuits with 401; `withTrace` always passes through.

**CT interpretation:** This is Kleisli composition with the `Either NextResponse`
short-circuit. See CATEGORIES.md §1.

### 14. Command
> Encapsulate a request as an object, thereby letting you parameterize clients with
> different requests, queue requests, and support undoable operations.

**Status: Not applied. Should consider.**

Server actions are currently plain functions. Wrapping them as Command objects would
enable:
- **Audit trail**: Each command is a record of who did what, when. Currently there's
  no systematic audit log.
- **Undo**: Unfavourite (already implemented as toggle), remove note, retract review.
- **Queuing**: Batch operations for editors (accept multiple papers).

**Should apply?** Yes, for editorial actions. Paper status transitions are the most
critical commands to track:

```typescript
interface EditorialCommand {
  type: "transition" | "assign-reviewer" | "publish";
  paperId: string;
  actorId: number;
  timestamp: Date;
  payload: unknown;
  execute(): Promise<Result>;
  // undo?(): Promise<Result>;  // for reversible commands
}
```

This also connects to event sourcing — if the journal grows, the paper lifecycle
could be reconstructed from its command history.

### 15. Interpreter
> Given a language, define a representation for its grammar along with an interpreter
> that uses the representation to interpret sentences in the language.

**Status: Not applied. Possibly applicable for search.**

The search module (`search.ts`) currently uses `plainto_tsquery` — it accepts plain
English and Postgres interprets it. If we add advanced search syntax (boolean operators,
field-specific queries like `author:lyra tag:category-theory`), an Interpreter pattern
would parse the query DSL into an AST and translate it to SQL.

**Should apply?** Not for V1. Consider when users ask for more powerful search.

### 16. Iterator
> Provide a way to access the elements of an aggregate object sequentially without
> exposing its underlying representation.

**Status: Implicitly applied.** Prisma query results are iterable. The search results
with `LIMIT`/`OFFSET` pagination implement cursor-free iteration. Note threads are
iterated recursively in rendering.

**Should apply?** Consider cursor-based pagination (keyset pagination) instead of
`OFFSET` for large result sets. Prisma supports cursor-based pagination natively:
```typescript
prisma.paper.findMany({ cursor: { id: lastId }, take: 20 })
```

### 17. Mediator
> Define an object that encapsulates how a set of objects interact. Mediator promotes
> loose coupling by keeping objects from referring to each other explicitly.

**Status: Not applied. Should consider.**

Paper submission currently triggers a chain of tightly coupled operations:
1. Validate input
2. Generate paper ID (requires DB transaction)
3. Create paper + authors + tags (same transaction)
4. Store files to two locations
5. Update paper with file paths

These steps know about each other. A Mediator would coordinate them without any step
knowing about the others:

```typescript
class SubmissionMediator {
  async submit(input: ValidatedInput): Promise<SubmitResult> {
    const paperId = await this.idGenerator.next();
    const paper = await this.repository.create(paperId, input);
    await this.storage.store(paperId, input.files);
    await this.repository.updatePaths(paperId, paths);
    // Future: await this.notifier.notifyEditors(paperId);
    return { success: true, paperId };
  }
}
```

**Should apply?** Yes, especially when adding notifications (email editors on
submission, email authors on status change). The Mediator coordinates without the
notifier knowing about the repository.

### 18. Memento
> Without violating encapsulation, capture and externalize an object's internal state
> so that the object can be restored to this state later.

**Status: Not applied. Applicable for paper versioning.**

If papers support revisions (V2, V3...), Memento would capture the paper's state at
each version. The dual-write to `submissions/` already preserves a snapshot of the
submission — this is a Memento on the filesystem.

**Should apply?** When paper versioning is added. Each version is a Memento of the
paper at a point in time.

### 19. Observer
> Define a one-to-many dependency between objects so that when one object changes
> state, all its dependents are notified and updated automatically.

**Status: Not applied. Should apply.**

This is the most obvious missing pattern. Status transitions should trigger
notifications:

| Event | Observers |
|-------|-----------|
| Paper submitted | Editors (email or dashboard) |
| Status → under-review | Author (email) |
| Review submitted | Editor + Author (email) |
| Status → accepted | Author (email), reviewers (visibility update) |
| Status → published | Author (email), all followers (RSS?) |
| Note added | Paper author, parent note author |

Currently, `revalidatePath()` in server actions is the only "notification" — it tells
Next.js to re-render a page. Real Observer would decouple the event from its effects.

**Should apply?** Absolutely, and soon. Start with an event bus:

```typescript
type JournalEvent =
  | { type: "paper.submitted"; paperId: string }
  | { type: "paper.transitioned"; paperId: string; from: string; to: string }
  | { type: "review.submitted"; paperId: string; reviewerId: number }
  | { type: "note.added"; paperId: string; noteId: number };

type EventHandler = (event: JournalEvent) => Promise<void>;
```

**CT interpretation:** Observer is extraction from a comonad — the subject provides
a context, and observers extract the information they need.

### 20. State ✅
> Allow an object to alter its behavior when its internal state changes. The object
> will appear to change its class.

**Status: Applied.** `paper-workflow.ts` is a State pattern. The paper's status
determines which transitions are valid (`canTransition`) and what side effects occur
(`transitionPaper`). The transition table (`VALID_TRANSITIONS`) and the side-effect
logic together implement state-dependent behaviour.

The current implementation uses a transition table rather than State objects (no
`SubmittedState`, `UnderReviewState` classes). This is simpler and appropriate for V1.

**Should evolve?** If each state needs significantly different behaviour (different
validation rules, different UI affordances, different permissions), extract State
objects. Currently the differences are small enough for the table approach.

**CT interpretation:** This is a finite automaton viewed as a category. See
CATEGORIES.md §5.

### 21. Strategy
> Define a family of algorithms, encapsulate each one, and make them interchangeable.
> Strategy lets the algorithm vary independently from clients that use it.

**Status: Not applied. Should consider.**

Applicable to:

1. **Search strategy**: Full-text (tsvector) vs. semantic (embeddings) vs. tag-based.
   The search interface is the same; the algorithm differs.

2. **Interest matching strategy**: Jaccard similarity vs. cosine similarity vs.
   collaborative filtering. As the user base grows, the matching algorithm should be
   swappable.

3. **Paper ID strategy**: Sequential (`YYYY-NNN`) vs. content-addressed (hash-based)
   vs. DOI-compatible. Unlikely to change, but worth noting.

**Should apply?** Yes for search, if multiple search backends are planned. Define a
`SearchStrategy` interface and implement `TsvectorSearch`, `SemanticSearch`, etc.

### 22. Template Method
> Define the skeleton of an algorithm in an operation, deferring some steps to
> subclasses. Template Method lets subclasses redefine certain steps of an algorithm
> without changing the algorithm's structure.

**Status: Not applied. Should consider for review workflow.**

The peer review process has a fixed structure:
1. Read the paper
2. Evaluate against criteria
3. Produce a structured review
4. Save the review

The *criteria* and *evaluation style* could vary — a research paper is evaluated
differently from an expository paper. A Template Method would define the review
skeleton while letting the category-specific evaluation vary:

```typescript
abstract class ReviewTemplate {
  async review(paper: Paper): Promise<Review> {
    const content = await this.readPaper(paper);
    const evaluation = await this.evaluate(content);    // varies by category
    const structured = await this.structure(evaluation); // varies by category
    return this.save(structured);
  }
  abstract evaluate(content: PaperContent): Promise<Evaluation>;
  abstract structure(eval: Evaluation): Promise<StructuredReview>;
}
```

**Should apply?** Consider when the review process needs to vary by paper category.

### 23. Visitor
> Represent an operation to be performed on the elements of an object structure.
> Visitor lets you define a new operation without changing the classes of the elements
> on which it operates.

**Status: Not applied. Applicable for analytics.**

If we need to compute different metrics over the paper collection without modifying
Paper:
- Citation count
- Download velocity
- Review sentiment
- Author h-index

A Visitor would walk the paper structure and compute each metric independently.

**Should apply?** Not for V1. Consider when analytics features are added. For now,
raw SQL queries suffice.

---

## Summary

### Already Applied (7 of 23)

| # | Pattern | Where |
|---|---------|-------|
| 2 | Builder | `RouteBuilder` fluent API |
| 3 | Factory Method | `stacks.ts` factory functions, `createPrismaClient()` |
| 5 | Singleton | Prisma `Proxy` with `globalThis` cache |
| 9 | Decorator | Middleware layers wrapping handlers |
| 10 | Facade | Server Actions hiding subsystem complexity |
| 12 | Proxy | Lazy Prisma client via JS `Proxy` |
| 13 | Chain of Responsibility | Middleware pipeline short-circuiting |
| 20 | State | Paper workflow transition table |

### Should Apply (8 of 23)

| # | Pattern | Why | Priority |
|---|---------|-----|----------|
| 6 | Adapter | Multiple auth providers, external API boundaries | Medium |
| 7 | Bridge | Swappable search backend | Low |
| 14 | Command | Audit trail, editorial action tracking | High |
| 17 | Mediator | Decouple submission pipeline steps | Medium |
| 19 | Observer | Event-driven notifications | **High** |
| 21 | Strategy | Multiple search algorithms | Low |
| 22 | Template Method | Category-specific review criteria | Low |
| 3 | Factory Method (more) | Paper/review creation extraction | Medium |

### Not Needed (8 of 23)

| # | Pattern | Reason |
|---|---------|--------|
| 1 | Abstract Factory | Prisma's adapter handles this |
| 4 | Prototype | No object cloning needed (until versioning) |
| 8 | Composite | Note tree is simple enough for recursive rendering |
| 11 | Flyweight | No fine-grained shared objects |
| 15 | Interpreter | No query DSL yet |
| 16 | Iterator | Built into Prisma/JS |
| 18 | Memento | No versioning yet |
| 23 | Visitor | No analytics pipeline yet |

---

## Cross-Reference: GoF ↔ Category Theory

Several GoF patterns have clean CT interpretations:

| GoF Pattern | CT Concept | Connection |
|-------------|------------|------------|
| Builder | Monoid | Accumulation with associative composition |
| Chain of Responsibility | Kleisli composition | Short-circuiting arrow chains |
| Decorator | Monad transformer | Layering effects around a computation |
| State | Finite automata as categories | States = objects, transitions = morphisms |
| Strategy | Morphisms in a functor category | Algorithms as arrows, interchangeable |
| Adapter | Natural transformation | Uniform interface conversion |
| Composite | Initial F-algebra | Recursive tree = fixed point of a functor |
| Observer | Comonad extraction | Extract relevant state from ambient context |
| Factory Method | Free functor | Freely generate objects from specifications |
| Singleton | Terminal object | Unique morphism from any module |
| Proxy | Identity functor with side effects | Same interface, controlled access |

The deepest connection: **the middleware system simultaneously implements Builder,
Chain of Responsibility, and Decorator — and all three are aspects of the same
Kleisli composition.** This is not a coincidence. Category theory unifies what GoF
separates into distinct patterns.
