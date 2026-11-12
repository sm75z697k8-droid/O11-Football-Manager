# Phase 6.8 — Seeded match variety without scripted outcomes

## Problem

The user reported that every repetition of O11 produced the same outcome. Inspection confirmed that the full-screen viewer always called `makeFictionalMatchSetup()` with seed `123456789`, so both the physical contact RNG and the deterministic utility decisions were reset to exactly the same conditions. A replay is correctly identical, but a fresh match should not reuse that seed automatically.

## New match and replay are intentionally distinct

- **REPLAY** creates a new `MatchViewerSession(currentSeed)`, preserving the exact match seed. Equal seed, fixture, player ratings and simulation inputs yield the exact same kick-off, contacts, AI choices, ball movement and score. It is valuable for debugging.
- **NEW MATCH** samples an unsigned 32-bit seed on a real user click using browser `crypto.getRandomValues`. A pure helper guarantees it differs from the preceding match even in the extremely unlikely event of a collision; `0xffffffff` wraps to zero. The user is never promised a unique seed globally or a different *score* every time; 32-bit seeds may theoretically repeat in different sessions.
- The selected seed is visible in the small top match overlay and optional footer. No server, account connection or local storage is required. Both buttons are present in the transport bar and again after an exhibition stoppage.
- The same fictional XI, pitch, real physical kick-off, attributes and rules remain unchanged. New match means a new **simulation instance** using a new seed, not a different team or fixture.

## Variation of sensible football decisions

The `src/game/ai/decision-variation.ts` helper uses the existing xoshiro128** seeded random stream engine with stable substream names built from match seed, the player ID, the simulation tick and the candidate action's stable enumeration order.

Only actions within **2.0 utility points** of the highest-scored football decision can vary. Greater Decisions, Composure and Vision ratings reduce the permitted decision noise; poor options that are clearly riskier or worse than the leading alternative remain excluded. The existing utility planner still computes genuine carrier pressure, passing-line obstruction, chance creation, player attributes, shooting corridors and dribbling opportunities. There is no random completed pass, forced goal, predetermined outcome or Math.random-based match logic.

The original deterministic best-utility evaluation remains callable for headless tactical diagnostics; the real autonomous match planner and scheduled physical pass/shot release explicitly use seed-aware judgment. When two kick-off recipients have similar first-touch, technique and anticipation ratings, the initial choice may also differ between seeds. A large ability advantage still dominates that modest opening-choice noise.

## Replay integrity and performance

No RNG draw is stored in mutable team decision streams: choices are keyed, stateless, deterministic seeded substreams. Thus repeated evaluation of an unchanged snapshot does not consume random numbers or alter physics RNG history. The `MATCH_STATE_SCHEMA_VERSION` and checkpoint version remain **9**, because there are no new stored state fields. The engine-version identifier changes to `o11-seeded-realistic-match-variation-p68-v1`, preventing silent cross-version replay.

Costs: no new network traffic, assets or persistent memory; one small seeded utility substream per viable candidate at an actual on-ball decision. No per-frame UI pseudorandom update. On iPhone Safari, the landscape viewer retains the existing capped canvas resolution.

## Verification and limitations

Regression tests confirm identical seeds generate byte-for-byte identical checkpoints across different tick chunk sizes, successful checkpoint restoration, both legal kick-off receiver options across many seeds, distinct real physical pass/contact outcomes across several seeds, bounded close-option variation, proper mental-attribute effects, and rejection of random choices that are clearly inferior. A separate multi-seed live-exhibition diagnostic records real pass and shot frequencies without requiring short, out-of-play-limited matches to produce a goal or shot. The current run of nine seeds produced different realistic physical sequences but no shots before out-of-play; attacking territory progression remains a known weakness for a future milestone.

**Important limitations:** This change diversifies simulations, but does not yet introduce realistic full-match variation driven by fatigue, tactics, substitutions, formations or opponent adaptation. Goals/out-of-play still end the exhibition, and the 256-command cap remains. Different seeds can occasionally yield identical scores or similar plays; realistic long-term tactical quality requires separate development and iPhone observation.
