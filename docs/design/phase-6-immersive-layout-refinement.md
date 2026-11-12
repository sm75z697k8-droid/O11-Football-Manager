# O11 — Phase 6 viewer refinement: immersive full-screen pitch

## Why

The user tested the real 2D viewer in iPhone Safari and reported that the large permanent information panels, navigation bars and footer made the pitch too small. A reference screenshot illustrated a **pitch-first, landscape football match view**. The new interface borrows only the visual principle, not any copyrighted FM assets, textures, player graphics or exact branding.

## Changed

- One **viewport-covering Canvas 2D** displays the authoritative 22-player engine and physical ball. The pitch remains fully contained at the correct **105:68 metric ratio**; no clipping of wide players or horizontal stretching of geometry to imitate a screenshot.
- The world around the pitch becomes a subtle, custom-drawn stadium backdrop with muted spectator tiers and brighter checked grass. This fills panoramic phones while keeping the full playable field and accurate screen-to-world hit testing.
- The large header, dashboard inspector and solid footer were replaced with a **small floating fixture strip**, compact elapsed **simulation** clock, transparent status label and low floating transport bar. Both clubs remain explicitly fictional, and there is no false score.
- Player details appear in a temporary compact card after tapping a physical player marker. The complete player inspector and actual physical contact log open in small, dismissible overlays. No permanently reserved sidebar.
- Play, Pause, single 50ms step, 1×/2×/4× physics pacing, Reset and player selection keep their existing authoritative behavior. The engine physics, AI, checkpoint schema, seed, rosters and commands are unchanged.
- When the actual ball crosses the boundary and the rules engine has no restart, the viewer automatically pauses **without inventing a football event**. It clearly says *Ball out of play* and offers Reset. This is a transparent diagnostic dead-end, **not** a fix for football match continuity.
- Safari viewport uses \`100dvh\`, safe-area CSS padding, small landscape view rules, resolution-capped Canvas and the original portrait-rotate guidance. Browser chrome may still appear in a Safari tab because a website cannot force OS immersive mode.

## What remains

The AI can still drive a ball carrier straight toward the goal line, and official goals, throw-ins, corners, goal kicks, kickoffs, offside and physical restarts remain **unimplemented**. Do not pretend the UI solves that simulation problem. A separate rules/restart phase needs explicit approval.

No iPhone runtime FPS, touch hit testing or actual visual appearance can be proven by GitHub's Node tests. The user must inspect the deployed screen, then we should correct layout concerns based on that test before adding more gameplay features.
