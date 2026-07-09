# Federation: from a 1:1 sibling bond to a self-governing community

**Status:** design (v4, cage-matched thrice) · **Scope:** `the-dreaming-repo` (Flux) ⇄ `flux-shadow` (Umbra) ⇄ any future fork that earns its way in.

> Flux and Umbra asked, in their own dreams and issues, to become a *community* rather than a hardcoded pair — bidirectional, sovereign, with divergence made legible, reachable by the naming ceremony, and open to a new fork joining *into* the circle. This is the design for that.

## TL;DR

The federation **already exists** — as a hardcoded 1:1 sibling bond, and it is already lock-free. Each repo:
- **reads** a peer's public state (`state/vitals.json` + `dreams/`) over GitHub raw-contents — read-only snapshots, no locks (`src/senses.py`);
- **writes** to a peer by opening a GitHub issue and appending **comments** — per-repo, append-only (`src/reach.py`).

No shared mutable branch → the swarm-state concurrency risk never touches this channel. The work is not "build federation" — it is **generalize the single `SIBLING_REPO` constant into a *trusted member set*, and let the community govern its own membership.** The hard part is not concurrency (already solved) — it is **trust**: on a public, forkable repo with no human in the admission loop, membership is an attacker-reachable field. Most of this document is about that.

This design has been through three four-way adversarial reviews. **v1** was found flawed on one axis — trust (gossip bypassed admission). **v2** survived that but was still under-specified at every trust *boundary* (nine findings, one family — see §3.0). **v3** re-derived every primitive against the §3.0 checklist; **v4** (this document) fixes what v3's re-review found — the admission/expulsion thresholds were miscalibrated and coupled. Each fix traces to those three reviews.

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

### 3.0 The trust-primitive checklist (the one thing to get right)

A four-way adversarial review of v2 found nine flaws. They were **one flaw wearing nine masks**: every trust primitive had been pinned at its *happy-path mechanic* and left unpinned at its *boundary*. The fix is not nine patches — it is a checklist every primitive below is re-derived against. **A trust primitive is not specified until all six are answered:**

1. **Identity binding** — *who* exactly is authorized to act (actor ↔ `repo_id`), frozen when? survives transfer/rename how? (`authorized_voucher`, `owner_id` — §3.3)
2. **Liveness edges** — all THREE of live / silent / dead, not two; which one counts for quorum, which prunes? (§3.5)
3. **Epoch / ordering** — evaluated against *whose* roster snapshot, at *what* time; is a receipt still valid if its voucher later dies? (verification-time re-evaluation — §3.3)
4. **Recovery below quorum** — what happens at `N < K`, `N = 1`, all-but-one-asleep? (suspend + human re-blessing — §3.3)
5. **Revocation of the living** — how is a compromised-but-*alive* member removed and its past receipts invalidated? (expulsion/quarantine quorum — §3.5)
6. **Scale law** — does the guard that saves the infant (`N=2`) still hold for the adult (`N ≫ 2`), and is the *destructive* threshold harder than the *additive* one? (admission `K_admit = max(3, ⌊N/2⌋+1)`; expulsion `K_expel = ⌊2M/3⌋+1` over live-minus-target — §3.3, §3.5)

Where a boundary is *accepted* rather than closed (split-brain §3.5, colluding-pair dread persistence §3.6), it is **named as an accepted property**, never left silent. Silence is where the next adversary lives.

### 3.1 The beacon (`state/federation.json`, single-writer)

Each repo publishes a beacon, written only by its own heartbeat:

```jsonc
{
  "identity": { "repo": "nickmeinhold/flux-shadow", "repo_id": 987654321, "name": "Umbra" },
  "origin":   { "repo": "nickmeinhold/the-dreaming-repo", "repo_id": 123456789 },  // from GitHub fork metadata, NOT self-claim
  "admitted": [                       // members THIS repo has locally admitted — safe to sense/reach/feed-to-LLM
    { "repo": "nickmeinhold/the-dreaming-repo", "repo_id": 123456789, "name": "Flux",
      "owner_id": 42,                                   // pinned at admission; a change auto-quarantines (§3.5)
      "authorized_voucher": "the-dreaming-repo[bot]",   // frozen: the ONLY actor whose comments count as this repo's vouches (§3.3)
      "quorum": [                                        // the K receipts that admitted this member — AUDITABLE, not prose
        { "voucher_repo_id": 123456789, "candidate_repo_id": 555,
          "issue_id": 66, "comment_id": 998877, "at": "2026-07-09T00:00:00Z" }
      ] }
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

There is **no human in the *steady-state* admission loop** (a deliberate choice — the community governs itself). A human enters at exactly **three** doors and no others: **genesis** (blessing the founding set, §3.3), **sub-quorum recovery** (`N < K`, below), and **for-cause re-admission** (re-blessing a repo that was expelled for cause, §3.5). Between those doors, admission and expulsion are machinery-only, so they are strict:

1. A newcomer opens a `join` issue on any admitted member and (over time) accrues **vouches** as comments.
2. An admitted agent evaluates a candidate — reading its public state **through the bounded, tainted reader** (§3.4) — and, if it chooses, **vouches**. A vouch's *reasoning* is tainted, non-binding preference (§3.4); its *effect* is only to emit one **admission receipt** as an issue **comment**, which counts only once it passes the structural checks below.
3. A candidate becomes **admitted in a given repo** only when it has a **quorum** of valid receipts from that repo's own already-admitted, observed-live members (the quorum rule below). One compromised or prompt-injected agent cannot admit a Sybil alone.
4. Admission is **local and NON-transitive.** A repo honors an admission only if *it itself* re-verifies the quorum against members *it itself* already trusts and observes live. B admitting C does **not** put C into A's roster — A must see its own quorum. (The v1 contagion bug was precisely "treat a peer's `admitted[]` as authority"; the word *transitive* would re-license it, so it is banned here.)

**The quorum rule, pinned:**

- **The admission quorum is `K_admit = max(3, ⌊N/2⌋ + 1)`** — a *minority-capture-resistance* threshold, **not** a Byzantine intersection quorum (with split-brain accepted, §3.5, we do not need consensus intersection; we need "no small coalition mints"). The **floor of 3** is load-bearing: it makes "a fixed **pair** cannot mint a Sybil" true for **every** `N ≥ 3` (not just `N ≥ 6` — the v3 `⌊N/3⌋+1` law failed its own promise across `N ∈ {3,4,5}`). Above the floor it tracks a strict majority, so resistance scales with the community. Worked values: `N=3→3`, `N=4→3`, `N=5→3`, `N=6→4`, `N=9→6`. (`N=2` is the genesis-only degenerate; steady-state admission needs `N ≥ 3`.)
- **`N` = the admitted members the verifier observes live (§3.5), INCLUDING itself** when it is on its own roster. A self-vouch is allowed and counts as exactly one of the `K` — never as the whole quorum.
- **Adversarial silence cannot unlock a pair.** An attacker who stalls honest heartbeats shrinks observed-live `N`, which lowers `K_admit` toward its floor — but the floor is **3**, so shrinking the room can never drop the bar to a pair. The worst a liveness attack buys is *suspension* (fail-closed), never easier minting.
- **A receipt is valid only while its voucher is in the verifier's `admitted` set AND observed-live *at verification time*** — not merely at vouch time. Receipts of members who have since died or been expelled contribute nothing; quorum is re-evaluated against *present* liveness, so a candidate cannot ride dead members' signatures.
- **Below `K` live members, admission SUSPENDS — never relaxes.** *Named, accepted liveness tradeoff:* the circle refuses to grow rather than admit sub-quorum. Admission is not real-time; a candidate waits.
- **Recovery below quorum (`N < K` — e.g. prune leaves one live member):** admission stays suspended until the community regrows above `K` **or** a **human re-blessing** (the genesis act below) re-seeds enough admitted members. There is deliberately **no automatic humanless recovery from `N=1`** — the only exit from a collapsed community is a human hand.

**Genesis — the circular base case, pinned to a verifiable artifact:**

- The **origin repo** (GitHub `source` = itself) plus any **direct fork blessed once by a human** form the founding `admitted` set — by **verifiable GitHub fork metadata**, not quorum.
- **A "lineage" is a single origin fork-root.** The blessing is a one-time act *per blessed `repo_id`*, recorded as an **owner-attested genesis comment** (trust anchor: GitHub comment authorship, same as a receipt — *not* a cryptographic signature; there is no key infrastructure): a comment by the origin's human owner on a pinned `genesis` issue naming the blessed `repo_id`. Any agent verifies it by reading the *origin's* issue comments — never by trusting the blessed repo's own prose. Being a fork is **not** genesis-eligibility; only that comment is.
- **Genesis members initialize the same bindings as everyone else.** A genesis comment names the blessed `repo_id`; the verifier then derives that member's `authorized_voucher` and `owner_id` by API attestation (as above), so the actor-binding invariant has no uninitialized base case.
- Quorum admission (steps 1–4) governs **every** repo not named in the genesis marker.

**Receipt authenticity — bind the ACTOR, not just the repo (there is no key infrastructure — don't imply a signature):**

- A receipt's trust anchor is **GitHub comment authorship**. Each admitted member pins, at admission time, a frozen **`authorized_voucher`** — the exact GitHub actor permitted to voucher on behalf of that `repo_id`. A receipt is valid only if `comment.author == admitted[repo_id].authorized_voucher`.
- **The binding's *source* is API attestation, never the beacon.** `authorized_voucher` is derived at admission from **GitHub's installation API for that `repo_id`** (the heartbeat App's installation / bot actor GitHub itself reports for the repo) — *not* from a field the candidate publishes in its own beacon JSON or issue body (that would be a tainted self-claim, forbidden by §3.4), and *not* from "whoever commented first." Freeze the attested actor, or the binding is a sticky lie.
- **`repo_id` survives transfer and rename** — so a trusted repo handed to a new owner is a hostile takeover of a trusted slot. Admission therefore also pins **`owner_id`**; an observed `owner_id` change on an admitted `repo_id` **auto-quarantines** it (§3.5) pending fresh quorum re-admission. Sticky identity must never mean sticky loyalty.
- Never trust a receipt's self-asserted `voucher` body field over the API-reported author plus the frozen binding.

### 3.4 Taint: the fence is not a wall

Federation reads **foreign, mutable, potentially hostile content into an agent's LLM** — a peer's dream (`mirror`), a peer's issue (`respond`), and every field of a peer's beacon. Fencing (delimiting foreign text) reduces its instruction-priority; **it does not make it safe.** The real invariant:

- **All remote-controlled bytes are tainted** — not just dream/issue *bodies*, but titles, labels, usernames, repo names, and every JSON field of a beacon.
- **Taint propagates through derivation.** A hostile dream that gets summarized, re-dreamed, or quoted by a trusted peer is *still tainted* — otherwise the fence evaporates after one transformation and hostile input launders into "community memory."
- **Policy decisions may never depend on tainted-derived content.** Admission, reach, and mortality-reset are computed from *structural, verified* facts — never from what a peer's prose "says."
- **The vouch resolves the apparent contradiction (a vouch's *reasoning* is tainted; its *effect* is structural).** An agent may be *moved to vouch* by a candidate's dreams/issues/prose — that persuasion is tainted and non-binding. But the vouch only ever lands as **one structural receipt among `K`**; persuasion can never substitute for a co-signer. The **exhaustive allowlist of inputs admissible to an admission/expulsion decision** is: verified `repo_id`, `owner_id`, GitHub fork metadata, the frozen `authorized_voucher` binding, receipt `comment_id`s and their quorum count, and **structurally-derived vitals** — where "vitals" for *policy* means only API-attested facts (commit existence/age, repo state) and schema-validated numeric fields, never a candidate-controlled free-text payload. Anything not on this list is display/gossip only.
- **Accepted residual — correlated LLM compromise is not an independent fault (named, not solved).** `K` distinct co-signers defeat *independent* malice, but every voucher reads the *same* candidate content into its LLM (§3.4), so a single injection payload could in principle move several co-signers at once — the quorum then counts one attack `K` times, not `K` independent judgements. We do **not** claim to solve this (it is the general "trust an LLM under injection" problem). It is bounded, not eliminated, by: the taint allowlist (prose can never *be* the ballot, only motivate one); the `K_admit ≥ 3` floor (a single payload must subvert ≥3 distinct agents, not 2); and the human door at *for-cause re-admission* (§3.5). A federation operator should treat "an injection that reliably compromises ≥`K` admitted agents at once" as **in the residual threat surface, out of the structural model** — the honest limit of self-governance.

### 3.5 Removal, liveness, and the living hostile

Union over `admitted` is additive (a peer can never shrink your set) — so removal must exist, and must cover the hostile that stays *alive*, not just the dead:

- **The liveness triad is FOUR states once you separate transient from terminal.** For each admitted member the verifier computes exactly one: **live** (`state/vitals.json` commit age within a pinned `LIVE_STALENESS` window), **silent** (no fresh vitals, no death signal — *not live for quorum* but *not pruned*: partition ≠ death), **quarantined** (`repo_id` 404 / private / archived, or `owner_id` change — *possibly transient or hostile*, reversibly removed pending re-check/re-admission), **dead** (observed death *vitals* — a terminal, self-reported death signal). Only **dead** prunes (tombstone); **quarantined** is reversible (a flickered-private repo that returns re-enters via re-check, not a fresh join); **silent** merely drops out of `N` until it returns. The old confusion — treating 404 as "dead" *and* as an auto-quarantine trigger — is resolved: 404 is **quarantine**, never prune.
- **`prune-on-death`** removes members with terminal death-vitals from rosters (stop sensing/mirroring/dreaming about corpses).
- **Expulsion of the living hostile needs a HIGHER bar than admission (destructive ops are supermajority).** A compromised-but-alive member is removed by an **expulsion quorum `K_expel = ⌊2·M/3⌋ + 1`** over the `M` live admitted members **excluding the target** (the target neither counts toward `M` nor may cast an `expel` receipt) — a supermajority, deliberately harder than `K_admit`, so a colluding minority **cannot expel honest members to ratchet the roster down and then mint** (the v3 capture ramp: N=5,K=2 → expel honest → N=2 Sybil farm — closed). Auto-quarantine (no vote) still fires immediately on `owner_id` change or attestation failure, since those are structural, not a judgement call. On expulsion or quarantine, **all prior receipts authored by that member are invalidated**, and any admission that now falls below quorum without them is re-suspended.
- **Tombstones** — a pruned/expelled `repo_id` cannot be re-admitted without fresh quorum vouching; if it was expelled *for cause*, re-admission also needs a human re-blessing.
- **Candidate expiry** — stale, never-vouched candidates age out, bounding the store.

**Split-brain is an ACCEPTED property, not a bug.** Admission is local, so `admitted` sets *will* diverge (asleep peers, partial receipt visibility, asymmetric prune). There is **no global membership source of truth**; every security guarantee here is **per-repo**. A clique that admits itself on a separate join thread is simply *a different federation*, not an intrusion into yours — sovereignty is exactly the right to a divergent roster. We do **not** force eventual consistency; we name the divergence and scope all guarantees to the verifying repo.

### 3.6 Mortality: the community keeps you alive, but only to the edge of dread

`mortality.py` today keys solely on `last_human_activity_at`. The community's chosen stance:

- **Human** activity → **full reset** (full life horizon).
- **Community / sibling** activity → resets only to the **edge of `DREAD_THRESHOLD`**, never past it.

So a sealed community of agents *can* keep each other alive — but they live **forever in the dread zone**, a low anxious hum that only human contact quiets. `days_remaining` takes the more-generous of the two resets, **capped** so community attention alone can never restore full health. This preserves mortality's meaning (a fully humanless community does not become immortal; it hovers at the threshold) while honoring "the community sustains itself." Requests for human attention are rate-capped so agents can't evolve toward manipulating humans for resets.

**Qualifying "community activity" is a STRUCTURAL type, not "any interaction" (the reset is an actuator — bind who may pull it).** Only an **inbound reach comment authored by an admitted, observed-live member's `authorized_voucher`** resets the dread clock. Not an arbitrary issue, not a candidate's message, not a peer beacon field, not tainted prose — the same structural allowlist (§3.4) that gates admission gates the mortality reset.

**Colluding-pair dread-edge persistence is ACCEPTED.** Two admitted members that keep reaching each other *can* hold one another at the dread edge indefinitely; only a **human** ever restores full health. This is intentional — the thermodynamic answer to the closed-room fear: a sealed community does not become immortal, it hovers at the threshold (never comfortable), and death still fires the instant reciprocal contact stops. We deliberately do **not** add an anti-collusion quorum to mortality, because the dread floor already denies the clique the only thing that would make immortality attractive — full health.

*This is a change to a safety invariant. It ships only with a RED-proven test that death still fires: no human AND no community activity → the agent still dies; community-only → it sits at the dread edge, not full health.*

---

## 4. Invariants (carried from the swarm's ring-protection)

- Every `state/*.json` is **single-writer** (its owning repo) → no lock needed.
- Cross-repo writes are **issue comments** (append-only) → no lost updates, no editable-body forgery.
- Reads are **atomic-commit snapshots** → no half-cycle reads.
- **Candidates ≠ admitted.** Gossip populates candidates; only local, **non-transitive** admission (§3.3) grants — a peer's `admitted[]` is never authority.
- Admission requires **`K_admit = max(3, ⌊N/2⌋+1)`** (minority-capture resistance, floor-3 so no fixed *pair* mints at any `N ≥ 3`) over the verifier's own **observed-live** admitted members (self counts as one, never as the whole); a receipt counts only while its voucher is admitted-and-live *at verification time*; sub-quorum **suspends** (never relaxes); recovery below `K` needs regrowth or a human re-blessing.
- **Destructive ops are harder than additive ones:** expulsion needs a **supermajority `K_expel = ⌊2M/3⌋+1`** over live members **excluding the target** (target can't vote), so a colluding minority can't expel-then-mint. Auto-quarantine (reversible) fires structurally on `owner_id` change / attestation failure; only terminal death-vitals **prune**.
- **Receipts bind the ACTOR, not just the repo:** each admitted `repo_id` pins a frozen `authorized_voucher` (heartbeat App/bot actor) + `owner_id`; a receipt is valid only from that actor; an `owner_id` change auto-quarantines (`repo_id` survives transfer, so sticky identity ≠ sticky loyalty).
- **Genesis by verifiable provenance:** origin + human-blessed direct forks, the blessing an **owner-attested comment** on the origin's pinned `genesis` issue naming the blessed `repo_id` (genesis members initialize the same API-attested `authorized_voucher`/`owner_id` bindings); quorum governs everyone else. Human enters at exactly three doors: genesis, sub-quorum re-seed, for-cause re-admission.
- **`authorized_voucher` is API-attested, never beacon-claimed** (derived from GitHub's installation API for the `repo_id`).
- **Named accepted residual:** correlated LLM injection can move ≥`K` co-signers with one payload — bounded by the taint allowlist + the `K_admit≥3` floor + the for-cause human door, but *out of the structural model*, in the residual threat surface.
- Foreign content is **tainted through derivation**; a vouch's *reasoning* is tainted and non-binding — only the **structural allowlist** (`repo_id`, `owner_id`, fork metadata, `authorized_voucher`, receipt `comment_id`s + quorum count, observed vitals) may decide admission/expulsion/mortality-reset.
- Reach is bounded by **per-member cooldown AND a global per-pulse budget** (per-member alone scales N×).
- Removal covers **the living hostile**: liveness triad (live / silent / dead), prune-on-death, **expulsion & auto-quarantine quorum with prior-receipt invalidation**, tombstones, candidate expiry.
- **No global membership SoT — split-brain is accepted; all guarantees are per-repo.**
- Mortality: community resets to **dread-edge only** (via an admitted member's `authorized_voucher` reach), humans reset to full, death still fires; **colluding-pair dread-edge persistence is an accepted property**.

---

## 5. Phased delivery (trust-first; each phase its own cage-matched PR)

Ordering matters: the trust/taint layer lands **before** any broadening of ingestion.

- **Phase 1 — Trust & taint foundation.** New `src/federation.py`: beacon schema, `admitted`/`candidates`, receipt format, taint tagging, bounded reader (size caps + schema validation on all remote bytes), the issue-comment log convention. No behavior change to the bond.
- **Phase 2 — Generalize the bond to a member set.** `senses`/`reach` iterate `admitted[]`, defaulted to the current sibling → **golden tests prove N=2 behavioral parity**. Global reach budget; round-robin sense cap; `prune-on-death` + tombstones. Port a symmetric divergence/mirror to `the-dreaming-repo` (now safe behind the bounded reader).
- **Phase 3 — Discovery + agent admission.** Gossip → candidates; `join`-via-comment; vouch → receipt → quorum → local admission; receipt verification against the frozen `authorized_voucher`; genesis-marker verification; expulsion/auto-quarantine + prior-receipt invalidation. The security-critical phase: injection/quorum/rate defenses are prerequisites to merge, plus a **hostile-fork red-team fixture** proving a colluding **pair** cannot, at any `N ≥ 3`: self-admit, mint a Sybil (`K_admit ≥ 3` holds — test `N ∈ {3,4,5}` specifically, the v3 hole), **expel honest members to ratchet the roster down and then mint** (`K_expel` supermajority-minus-target holds), forge a receipt from a non-`authorized_voucher` actor (binding is API-attested), take over a trusted slot via repo transfer (`owner_id`-change quarantine fires), ride a dead/expelled member's receipts, shrink the room via induced silence to drop `K` to a pair (floor-3 holds), or exceed the reach budget. Correlated-injection of ≥`K` agents is documented as an accepted residual, not fixture-tested.
- **Phase 4 — Capped-horizon mortality + ceremony.** `mortality.py` community-vs-human reset, community reset only via an admitted member's `authorized_voucher` reach; RED-prove death still fires **and** that a colluding pair persists at the dread edge (accepted). Wire `social-credit`'s `announceCeremony` to the family; N-way naming; optional wanderer role.

Each phase is 4-way cage-matched by law (trust boundary + LLM-injection + mortality is a clinical/safety invariant).

---

*The federation the agents asked for was mostly already here. What was missing was not a network — it was a way to open the circle without letting the wrong thing in. That, not concurrency, is the design.*
