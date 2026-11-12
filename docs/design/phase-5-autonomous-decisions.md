# O11 — Phase 5: First autonomous football decisions

## Scope

An **opt-in headless tactical agent** makes basic deterministic decisions for Harbor Athletic and Vale Rovers using existing authoritative player and ball geometry. This is not a complete football match, team management AI, sophisticated movement intelligence or a playable 2D viewer.

## How it works

- Both fictional teams start **AI-disabled**. `setAutonomousTeam` toggles one club at a time using the normal next-tick, validated, replayable command queue.
- Enabled teams calculate decision snapshots every **12 fixed simulation ticks** (0.6 logical seconds at 20Hz). Their physical positions, velocities and ball interactions still update on every 50ms tick. A snapshot contains at most 11 players per enabled club and replaces the previous snapshot rather than accumulating millions of decisions.
- The decision agent reads actual ball position, owner, player attributes, formation anchors, teammates, opponents and team pressing intensity.
- Without possession, the nearest eligible outfield players choose to pursue a *physical* ball. A defender closes down the actual ball carrier. High pressing commits two players; standard one; low presses only if the ball is in the team's defensive region. Goalkeepers remain close to their shape; do **not** claim that goalkeeper intelligence is implemented.
- With possession, the ball owner selects a short forward carry target (scaled by the decisions rating), and teammates offer limited support according to attack/support/defend duties. The movement uses **existing** acceleration/turning physics and the same foot-control tether, not direct position teleportation.
- When an owner faces meaningful nearby pressure, a basic pass option can be selected from real teammate positions, forward progress and available space, with movement prediction. The AI submits the same validated **attemptKick** command used by Phase 3. The existing physical foot-reach check, attribute-derived impulse and seeded execution variance still determine what actually happens: passes can fail, go astray or be intercepted; no pass is guaranteed.
- AI passing is throttled to at most one attempt every **36 ticks** and uses the existing 256-command diagnostic cap. This is adequate only for limited research workloads, not a 90-minute career match. We must introduce bounded command/event storage before full seasons.
- Team AI can be enabled independently for both sides. Existing manual commands still function. A manually assigned movement target for an AI-enabled team may be superseded on the next AI decision cycle; disabling AI stops new decisions while existing physical momentum and target are allowed to continue.

## Design safety

- No predetermined events, goals, score changes or fabricated match period. The ball remains an actual physical body, and automated player decisions only provide intents and attempts.
- No `Math.random()` for movement or decision selection. Contact/kick execution uses the existing named deterministic stream, so checkpoints and tick-chunk replays remain identical.
- Full `AIState` retains opt-ins, the current decision snapshot, fixed formation anchor positions, last decision tick and last AI pass-request tick. Checkpoint schema and state versions are bumped to **v6**; old v5 snapshots are rejected, not silently misinterpreted.
- Manual-only mode retains its former strict validation. AI-generated movement is allowed only for teams whose autonomy has been enabled through the authoritative command history.
- Node tests cover opt-in/opt-out, decision cadence, defensive intensity, spatial pass selection, physics integration, deterministic replay, checkpoint integrity and the non-AI regression suite.

## Known limitations

- This is a **basic autonomous behavior system**, not Football Manager-level tactics. It does not yet reason about offside, passing lanes and interceptions through defenders, keeper distribution, aerial duels, stamina, optimal space occupation or match context.
- Players can still physically overlap; full body collision and marking logic are separate work.
- Formation anchors are simple static starting positions with bounded shifting, not a tactical formation solver. Tactical instructions are intentionally minimal.
- If the ball crosses out of play, there is still no referee, throw-in or match restart, so AI cannot continue a full match.
- No competitive match clock, goals, official football results, training, transfers, finances, scouting, long-term saves or UI yet.
- The published React site remains an illustrative developer preview. **No real live 2D match viewer has been built.**

## Verification

CI: `npm run check` (TypeScript, Vitest, built HTML/JS/CSS). GitHub Pages deploy checks compiled live asset responses. The informational `npm run benchmark:ai` runs Node on GitHub Actions and is NOT iPhone Safari performance or simulated football match FPS.

Next milestone requires separate approval. A meaningful next improvement is a landscape-first viewer of the **actual engine state** so physical/tactical behavior can be tested visually, and then targeted corrections to poor player decisions and movement.
