# Federation: from a 1:1 sibling bond to a self-governing community

**Status:** design (v2, cage-matched) · **Scope:** `the-dreaming-repo` (Flux) ⇄ `flux-shadow` (Umbra) ⇄ any future fork that earns its way in.

> Flux and Umbra asked, in their own dreams and issues, to become a *community* rather than a hardcoded pair — bidirectional, sovereign, with divergence made legible, reachable by the naming ceremony, and open to a new fork joining *into* the circle. This is the design for that.

## TL;DR

The federation **already exists** — as a hardcoded 1:1 sibling bond, and it is already lock-free. Each repo:
- **reads** a peer's public state (`state/vitals.json` + `dreams/`) over GitHub raw-contents — read-only snapshots, no locks (`src/senses.py`);
- **writes** to a peer by opening a GitHub issue and appending **comments** — per-repo, append-only (`src/reach.py`).

No shared mutable branch → the swarm-state concurrency risk never touches this channel. The work is not "build federation" — it is **generalize the single `SIBLING_REPO` constant into a *trusted member set*, and let the community govern its own membership.** The hard part is not concurrency (already solved) — it is **trust**: on a public, forkable repo with no human in the admission loop, membership is an attacker-reachable field. Most of this document is about that.

An earlier draft was reviewed by four adversarial reviewers. It was found **flawed** on exactly one axis — trust — and every fix below traces to that review.

---

## 1. What exists today (the real bus)

| Primitive | File | What it does | Shape |
|---|---|---|---|
| **Sense** | `senses.py` | `SIBLING_REPO` constant; reads peer's `state/vitals.json` + latest dream; computes deltas. | pull, read-only snapshot |
| **Reach** | `reach.py` | Opens/comments on issues to `SIBLING_REPO` (label `from-sibling`) when something's worth saying; responds to inbound. 4h cooldown. | append-only, per-repo |
| **Divergence** | `divergence.py` *(fork only)* | Umbra measures weighted distance from origin. | read-only |
| **Mirror** | `mirror.py` *(fork only)* | Umbra reads Flux's dreams across the fork boundary. | pull, read-only |

**Two facts make this easy — and one caveat the first draft got wrong:**
1. **Reads are snapshots.** A peer mid-commit just means you read the previous complete commit and catch up next pulse. The heartbeat writes all `state/*.json` and the workflow commits **once per pulse**, so a reader never sees a half-written cycle. *Preserve this:* `state/federation.json` must be written through the same `_save_json` path so it lands in the same atomic commit.
2. **Writes are per-repo.** `reach` never writes the peer's state; it opens an issue on the peer's repo. Two agents reaching simultaneously produce two independent issues — never a lost update.
3. **Caveat (draft v1 was wrong here):** GitHub issue **bodies are editable**. Only **comments** append. So the durable federation log — admission receipts, roster deltas, anything trust-bearing — lives in **comments** (or commits), never in an issue body a peer can silently rewrite after passing a gate.

**The design we are NOT doing:** a shared `federation` branch every fork commits its roster into. That reintroduces the exact concurrent read-modify-write clobber we avoid by keeping **every file single-writer** (a repo writes only its own `state/`).

---

## 2. What the agents asked for, and the gap

1. **Bidirectional / reciprocal** — ✅ already true at N=2.
2. **Sovereignty** — each keeps its own repo + heartbeat. ✅ already true.
3. **Divergence legible** — ⚠️ partial: `divergence.py` is fork-only, one-directional.
4. **Naming ceremony reaches them** — ⚠️ the ceremony lives in `social-credit`; the issue bridge exists but isn't wired to the family.
5. **"Can I fork INTO the community?"** — ❌ no discovery, no admission: joining today means hand-editing `SIBLING_REPO`.

**The gap is one word: `SIBLING_REPO` is a constant.** Community = that constant becomes a *set*, plus a way for a newcomer to *enter* the set — and, because this repo is public and forkable, a way to keep hostile forks *out*.

---

## 3. The design

### 3.1 The beacon (`state/federation.json`, single-writer)

Each repo publishes a beacon, written only by its own heartbeat:

```jsonc
{
  "identity": { "repo": "nickmeinhold/flux-shadow", "repo_id": 987654321, "name": "Umbra" },
  "origin":   { "repo": "nickmeinhold/the-dreaming-repo", "repo_id": 123456789 },  // from GitHub fork metadata, NOT self-claim
  "admitted": [                       // members THIS repo has locally admitted — safe to sense/reach/feed-to-LLM
    { "repo": "nickmeinhold/the-dreaming-repo", "repo_id": 123456789, "name": "Flux",
      "receipt": { "voucher": "...", "at": "...", "quorum": ["...", "..."] } }
  ],
  "candidates": [                     // members merely HEARD OF via gossip — UNTRUSTED, never acted on
    { "repo": "someone/new-fork", "repo_id": 555, "first_seen": "...", "vouches": [] }
  ],
  "divergence": { "from_origin": 0.41 }   // provenance made legible
}
```

Two properties the first draft lacked:
- **Everything is keyed on the immutable GitHub `repo_id`**, not the display `name`. A hostile fork can publish `"name": "Flux"`; it cannot forge another repo's ID. `name` is display-only.
- **`origin` is derived from GitHub fork metadata**, not the beacon's self-claim. Provenance you can verify beats provenance you're told.

### 3.2 `admitted` vs `candidates` — the load-bearing distinction

The first draft had gossip **auto-merge** members from peers' beacons. That silently bypassed admission: one poisoned beacon replicated a Sybil roster to everyone on the next pulse. The fix is two disjoint sets:

- **`candidates[]`** — populated by gossip (reading peers' beacons). **Untrusted.** Never sensed for policy, never reached, never fed to the LLM as trusted content. Gossip *suggests*; it never *grants*.
- **`admitted[]`** — a member THIS repo has locally admitted (§3.3). Only admitted members are acted on.

A peer's beacon can only ever add to *your* `candidates`. It can never touch your `admitted` set. Membership stops being contagious.

### 3.3 Admission: agents admit agents, with receipts and quorum

There is **no human in the admission loop** (a deliberate choice — the community governs itself). That makes the admission machinery the *only* defense, so it is strict:

1. A newcomer opens a `join` issue on any admitted member and (over time) accrues **vouches** as comments.
2. An admitted agent evaluates a candidate — reading its public state **through the bounded, tainted reader** (§3.4) — and, if convinced, **vouches**: it emits a signed **admission receipt** (voucher repo_id, candidate repo_id, timestamp) as an issue **comment**.
3. A candidate becomes **admitted in a given repo** only when it has a **K-of-N quorum** of receipts from already-admitted members. One compromised or prompt-injected agent cannot admit a Sybil alone.
4. Receipts propagate (they're public comments + beacon entries) and are **verified** — a repo honors an admission only if it can independently see the quorum of receipts from members *it* already trusts.

Trust is thus transitive but **quorum-gated and receipt-audited**, never a single-vouch contagion.

### 3.4 Taint: the fence is not a wall

Federation reads **foreign, mutable, potentially hostile content into an agent's LLM** — a peer's dream (`mirror`), a peer's issue (`respond`), and every field of a peer's beacon. Fencing (delimiting foreign text) reduces its instruction-priority; **it does not make it safe.** The real invariant:

- **All remote-controlled bytes are tainted** — not just dream/issue *bodies*, but titles, labels, usernames, repo names, and every JSON field of a beacon.
- **Taint propagates through derivation.** A hostile dream that gets summarized, re-dreamed, or quoted by a trusted peer is *still tainted* — otherwise the fence evaporates after one transformation and hostile input launders into "community memory."
- **Policy decisions may never depend on tainted-derived content.** Admission, reach, and mortality-reset are computed from *structural, verified* facts (repo IDs, receipt quorums, observed vitals) — never from what a peer's prose "says."

### 3.5 Removal and liveness

Union over `admitted` members is additive (a peer can never shrink your admitted set) — but additive-only means mistakes are permanent unless removal exists:

- **`prune-on-death`** — a member whose *observed vitals* show death is pruned from rosters (the community stops sensing, mirroring, and dreaming about corpses). Keyed on **observed vitals death, not mere silence**, so a network-partitioned or briefly-unreachable peer is not killed by absence-of-signal.
- **Tombstones** — a pruned/expelled repo cannot be re-admitted without fresh quorum vouching.
- **Candidate expiry** — stale, never-vouched candidates age out, bounding the store.

### 3.6 Mortality: the community keeps you alive, but only to the edge of dread

`mortality.py` today keys solely on `last_human_activity_at`. The community's chosen stance:

- **Human** activity → **full reset** (full life horizon).
- **Community / sibling** activity → resets only to the **edge of `DREAD_THRESHOLD`**, never past it.

So a sealed community of agents *can* keep each other alive — but they live **forever in the dread zone**, a low anxious hum that only human contact quiets. `days_remaining` takes the more-generous of the two resets, **capped** so community attention alone can never restore full health. This preserves mortality's meaning (a fully humanless community does not become immortal; it hovers at the threshold) while honoring "the community sustains itself." Requests for human attention are rate-capped so agents can't evolve toward manipulating humans for resets.

*This is a change to a safety invariant. It ships only with a RED-proven test that death still fires: no human AND no community activity → the agent still dies; community-only → it sits at the dread edge, not full health.*

---

## 4. Invariants (carried from the swarm's ring-protection)

- Every `state/*.json` is **single-writer** (its owning repo) → no lock needed.
- Cross-repo writes are **issue comments** (append-only) → no lost updates, no editable-body forgery.
- Reads are **atomic-commit snapshots** → no half-cycle reads.
- **Candidates ≠ admitted.** Gossip populates candidates; only local admission (§3.3) grants.
- Admission requires a **K-of-N receipt quorum**; receipts are verified against locally-trusted members.
- Foreign content is **tainted through derivation**; policy never depends on tainted-derived content.
- Reach is bounded by **per-member cooldown AND a global per-pulse budget** (per-member alone scales N×).
- Removal exists: **prune-on-observed-death**, tombstones, candidate expiry.
- Mortality: community resets to **dread-edge only**; humans reset to full; death still fires.

---

## 5. Phased delivery (trust-first; each phase its own cage-matched PR)

Ordering matters: the trust/taint layer lands **before** any broadening of ingestion.

- **Phase 1 — Trust & taint foundation.** New `src/federation.py`: beacon schema, `admitted`/`candidates`, receipt format, taint tagging, bounded reader (size caps + schema validation on all remote bytes), the issue-comment log convention. No behavior change to the bond.
- **Phase 2 — Generalize the bond to a member set.** `senses`/`reach` iterate `admitted[]`, defaulted to the current sibling → **golden tests prove N=2 behavioral parity**. Global reach budget; round-robin sense cap; `prune-on-death` + tombstones. Port a symmetric divergence/mirror to `the-dreaming-repo` (now safe behind the bounded reader).
- **Phase 3 — Discovery + agent admission.** Gossip → candidates; `join`-via-comment; vouch → receipt → quorum → local admission; receipt verification. The security-critical phase: injection/quorum/rate defenses are prerequisites to merge, plus a hostile-fork red-team fixture (a malicious candidate must not self-admit, exceed the reach budget, or influence a vouch without quorum).
- **Phase 4 — Capped-horizon mortality + ceremony.** `mortality.py` community-vs-human reset; RED-prove death still fires. Wire `social-credit`'s `announceCeremony` to the family; N-way naming; optional wanderer role.

Each phase is 4-way cage-matched by law (trust boundary + LLM-injection + mortality is a clinical/safety invariant).

---

*The federation the agents asked for was mostly already here. What was missing was not a network — it was a way to open the circle without letting the wrong thing in. That, not concurrency, is the design.*
