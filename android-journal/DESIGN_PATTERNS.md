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

**Status: Applied.** `GitHubAuthAdapter` (`auth/adapter.ts`) + wired in OAuth callback.

The `AuthAdapter<ExternalUser>` interface converts external user representations
(GitHub API response) into the Journal's `UserUpsertData`. The OAuth callback imports
and uses `GitHubAuthAdapter.toJournalUser()` — no inline mapping.

If we add more auth providers (GitLab, email), each implements `AuthAdapter<T>`.

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

**CT interpretation:** Previously this document claimed Strategy corresponds to
"morphisms in a functor category." That claim is wrong. For strategies to be
morphisms between the same pair of functors in [C, D], they need shared source and
target functors. In practice, different strategies produce structurally different
outputs (different serialization formats, different sanitization policies, different
search result shapes), which means different target functors — not different arrows
between the same two. Examples that do share source and target (e.g., sorting, where
both functors are `List`) have trivial naturality via parametricity, so the functor
category framing adds no insight. The honest description: Strategy is a morphism in a
hom-set. You have `Hom(A, B)` and you pick an arrow. The client is parameterised over
which arrow. No functor categories needed.

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

### Already Applied (8 of 23)

| # | Pattern | Where |
|---|---------|-------|
| 2 | Builder | `RouteBuilder` fluent API |
| 3 | Factory Method | `stacks.ts` factory functions, `createPrismaClient()` |
| 5 | Singleton | Prisma `Proxy` with `globalThis` cache |
| 6 | Adapter | `GitHubAuthAdapter` in `auth/adapter.ts`, wired in OAuth callback |
| 9 | Decorator | Middleware layers wrapping handlers |
| 10 | Facade | Server Actions hiding subsystem complexity |
| 12 | Proxy | Lazy Prisma client via JS `Proxy` |
| 13 | Chain of Responsibility | Middleware pipeline short-circuiting |
| 20 | State | Paper workflow transition table |

### Should Apply — V2 (6 of 23)

| # | Pattern | Why | Priority |
|---|---------|-----|----------|
| 7 | Bridge | Swappable search backend | Low |
| 14 | Command | Audit trail, editorial action tracking (V2: wire `commands/`) | High |
| 19 | Observer | Event-driven notifications (V2: wire `events/`) | **High** |
| 21 | Strategy | Multiple search algorithms | Low |
| 22 | Template Method | Category-specific review criteria | Low |
| 3 | Factory Method (more) | Paper/review creation extraction | Medium |

### Not Needed (9 of 23)

| # | Pattern | Reason |
|---|---------|--------|
| 1 | Abstract Factory | Prisma's adapter handles this |
| 4 | Prototype | No object cloning needed (until versioning) |
| 8 | Composite | Note tree is simple enough for recursive rendering |
| 11 | Flyweight | No fine-grained shared objects |
| 15 | Interpreter | No query DSL yet |
| 16 | Iterator | Built into Prisma/JS |
| 17 | Mediator | Removed — submission pipeline is simple enough without coordination |
| 18 | Memento | No versioning yet |
| 23 | Visitor | No analytics pipeline yet |

---

## Cross-Reference: GoF ↔ Category Theory

Several GoF patterns have clean CT interpretations:

| GoF Pattern / Library | CT Concept | Connection |
|----------------------|------------|------------|
| Builder | Monoid | Accumulation with associative composition |
| Chain of Responsibility | Kleisli composition | Short-circuiting arrow chains |
| Decorator | Monad transformer | Layering effects around a computation |
| State | Finite automata as categories | States = objects, transitions = morphisms |
| Strategy | Morphism in a hom-set | Pick an arrow from Hom(A, B); no deeper CT structure |
| Adapter | Natural transformation | Uniform interface conversion |
| Composite | Initial F-algebra | Recursive tree = fixed point of a functor |
| Observer | Comonad extraction | Extract relevant state from ambient context |
| Factory Method | Free functor | Freely generate objects from specifications |
| Singleton | Terminal object | Unique morphism from any module |
| Proxy | Identity functor with side effects | Same interface, controlled access |
| Result (`result.ts`) | Either monad | `ok`/`err` with `flatMap`, `fold`, `toActionResult` bridge |
| Validation (`validation/`) | Free applicative functor | Error accumulation over string[] monoid |

The deepest connection: **the middleware system simultaneously implements Builder,
Chain of Responsibility, and Decorator — and all three are aspects of the same
Kleisli composition.** This is not a coincidence. Category theory unifies what GoF
separates into distinct patterns.

---

## Noether's Theorem for State Machines

Emmy Noether proved that every continuous symmetry of a physical system corresponds
to a conserved quantity. The paper workflow is a discrete dynamical system — states
are configurations, transitions are dynamics, and the integration tests
(`state-invariants.integration.test.ts`) verify conserved quantities at every step
of random walks through the state machine.

Working backwards from the conserved quantities (invariants) to the symmetries that
produce them:

### 1. Path Permutation Symmetry → Audit Count Conservation

**Symmetry:** The transition function (`paper-workflow.ts:28–129`) treats all valid
transitions identically. It doesn't know *which* edge it's traversing — it fires
`paper.transitioned` (line 88–93) and increments the count by one regardless of
whether the step is `submitted → under-review` or `revision → under-review`. Swap
any valid path of length *n* for any other valid path of length *n*, and the audit
count is unchanged.

**Conserved quantity:** `count(paper.transitioned) = |path|`
(`state-invariants.integration.test.ts:272–273`)

```typescript
const transitionCount = await countAuditEvents(paper.paperId, "paper.transitioned");
expect(transitionCount).toBe(path.length);
```

This is the direct analogue of **time-translation symmetry → energy conservation**.
Each step in the walk is "the same" from the audit logger's perspective — the
Lagrangian doesn't depend on *when* (which step) a transition occurs, only that one
occurred.

### 2. Revision Cycle Symmetry → Review Accumulation

**Symmetry:** The subgraph `under-review ⇄ revision` generates a free monoid **ℕ**
acting on the state space. The transition table (`paper-workflow.ts:13–18`) allows
this cycle to repeat indefinitely. Go around the loop 1 time, 3 times, 17 times —
the system doesn't care. Each revolution is structurally identical to every other.

**Conserved quantity:** All completed reviews from *all* cycles are preserved and
become visible upon acceptance — not just the most recent round's reviews.
(`state-invariants.integration.test.ts:320–378`)

```typescript
const visibleCompleted = state.reviews.filter(
  (r) => r.verdict !== "pending" && r.visible,
);
expect(visibleCompleted).toHaveLength(revisionCycles);
```

This is the analogue of **rotational symmetry → angular momentum conservation**.
The rotation (revision cycle) preserves the accumulated quantity (reviews). The
cycle is a faithful **ℕ**-action — it accumulates but never destroys.

### 3. Gauge Symmetry of Paths → Visibility Partition

**Symmetry:** Review visibility depends *only* on the current state, not on the
path taken to reach it. Two paths ending in the same state produce identical
visibility configurations. The specific route is a gauge degree of freedom — it's
"internal" and doesn't affect the observable. This is the Myhill-Nerode criterion
noted in the test file header: equivalence classes (statuses) have well-defined
observable properties regardless of which path landed us there.

**Conserved quantity:** The clean partition
`{submitted, under-review, revision} → hidden`, `{accepted, published} → visible`.
(`state-invariants.integration.test.ts:139–158`)

```typescript
// Pre-acceptance: reviews hidden
if (status === "submitted" || status === "under-review" || status === "revision") {
  for (const r of completedReviews) {
    if (r.visible) violations.push(/* ... */);
  }
}
// Post-acceptance: reviews visible
if (status === "accepted" || status === "published") {
  for (const r of completedReviews) {
    if (!r.visible) violations.push(/* ... */);
  }
}
```

This is **gauge invariance**. The path is unphysical; only the endpoint is
observable. The conserved quantity is the partition itself — a topological invariant
of the state space that respects the two connected components separated by the
acceptance boundary.

### 4. Absorption Symmetry Breaking → Publication Uniqueness

**Symmetry that is *broken*:** `published` is an absorbing state — no outgoing
edges. Time-reversal symmetry is broken here. You can't un-publish.

**Conserved quantity from the breaking:** `paper.published` fires exactly once, and
`publishedAt ≠ null ⟺ status = published`.
(`state-invariants.integration.test.ts:129–137, 275–278`)

```typescript
if (status === "published") {
  if (!publishedAt) violations.push("published paper must have publishedAt set");
} else {
  if (publishedAt) violations.push(`non-published paper must not have publishedAt`);
}
```

This is the analogue of **spontaneous symmetry breaking → order parameter**. The
system transitions from a symmetric phase (where states can change freely) to an
ordered phase (frozen at `published`). The `publishedAt` timestamp is the order
parameter — it crystallises at the moment of breaking and never changes again.

### 5. Serialisation Symmetry → Concurrency Integrity

**Symmetry:** Permute the arrival order of concurrent transitions. The optimistic
lock (`paper-workflow.ts:57–64`) ensures exactly one wins regardless of ordering:

```typescript
const { count } = await tx.paper.updateMany({
  where: { id: paper.id, status: paper.status },
  data,
});
if (count === 0) return err("Paper status changed concurrently, please retry");
```

The system is invariant under permutation of concurrent actors.

**Conserved quantity:** Exactly one transition succeeds, and all structural
invariants hold in the final state.
(`state-invariants.integration.test.ts:382–424`)

```typescript
const successes = [result1, result2].filter((r) => r.success);
expect(successes).toHaveLength(1);
const violations = checkInvariant(state);
expect(violations).toEqual([]);
```

This is a **discrete permutation symmetry** — the analogue of exchange symmetry in
quantum mechanics. Two identical transitions are like identical particles; the
system can't distinguish their ordering, and the observable (final state) is
symmetric under exchange.

### 6. Functoriality of the Audit Log → Transition Faithfulness

**Symmetry:** The audit log is a faithful functor **F: Path(G) → Set** from the
path category of the state machine to the category of event sequences. Every
morphism (transition) maps to exactly one audit event with matching `from`/`to`.
Invalid morphisms (not in the category) map to `transition.rejected`.
(`state-invariants.integration.test.ts:254–266`)

```typescript
const lastTransition = await lastAuditEvent(paper.paperId, "paper.transitioned");
const tDetails = JSON.parse(lastTransition!.details!);
expect(tDetails.from).toBe(prevStatus);
expect(tDetails.to).toBe(target);
```

**Conserved quantity:** The isomorphism between the path in state space and the
sequence in the audit log. You can reconstruct the entire path from the log alone —
no information is lost.

This is the deepest symmetry — it's **naturality**. The audit functor commutes with
the dynamics. It's the analogue of Noether's theorem *itself* rather than any
particular instance: the existence of a structure-preserving map between two
representations of the same system guarantees that information is conserved across
the translation.

### Topology of the State Graph

The state graph has a **critical boundary** between `{submitted, under-review,
revision}` and `{accepted, published}`. Crossing it (acceptance) is irreversible
and triggers the phase transition where reviews become visible. The revision cycle
lives entirely in the pre-acceptance region and can run indefinitely without
crossing the boundary.

The absorbing state `published` is a second, harder boundary — not just
irreversible but terminal. The system has two symmetry-breaking events:
1. **Acceptance** — reviews crystallise (visibility gauge symmetry breaks)
2. **Publication** — the state itself crystallises (time-translation symmetry breaks)

```
                    ┌─────────────────────────┐
                    │   pre-acceptance phase   │
                    │                          │
                    │  submitted               │
                    │      │                   │
                    │      ▼                   │
   revision cycle → │  under-review ⇄ revision │
   (ℕ-action)      │                          │
                    └──────────┬───────────────┘
                               │ ← acceptance boundary (phase transition)
                    ┌──────────▼───────────────┐
                    │   post-acceptance phase   │
                    │                          │
                    │  accepted                │
                    │      │                   │
                    │      ▼                   │
                    │  published ●              │ ← absorbing state (order parameter)
                    └──────────────────────────┘
```

Categorically: the invariants form a **presheaf** on the state graph — they assign
data (visibility, timestamps, counts) to each object and respect the morphism
structure. The symmetries are the **automorphisms of this presheaf** — the
transformations under which the assigned data is unchanged.

### Summary: Noether Correspondence

| # | Symmetry | Conserved Quantity | Physics Analogue |
|---|----------|--------------------|------------------|
| 1 | Path permutation | Audit count = path length | Time translation → energy |
| 2 | Revision cycle (**ℕ**-action) | Review accumulation across rounds | Rotation → angular momentum |
| 3 | Gauge (path independence) | Visibility partition by state | Gauge invariance → charge |
| 4 | Absorption (broken symmetry) | `publishedAt` uniqueness | SSB → order parameter |
| 5 | Serialisation (actor permutation) | Exactly-one-wins under concurrency | Exchange symmetry |
| 6 | Functoriality (audit as functor) | Path ↔ log isomorphism | Naturality (Noether itself) |
