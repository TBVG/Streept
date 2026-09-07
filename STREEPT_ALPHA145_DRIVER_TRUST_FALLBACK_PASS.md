# Streept Alpha 145 — Driver Trust & Guidance Fallback

Alpha 145 makes the immersive renderer explicit about what it is allowed to claim.

## Guidance hierarchy
1. **Lane** — used only when lane matching and GPS confidence are strong enough.
2. **Junction** — used when lane matching is uncertain but physical connector topology is reliable.
3. **Route** — used when neither lane nor junction geometry can be trusted; the scene preserves route continuity without asserting a lane.
4. **Maneuver** — severe uncertainty suppresses physical lane/branch claims and leaves the maneuver instruction as the authoritative navigation signal.

The fallback is renderer-neutral and never changes routing decisions. It prevents weak lane or branch geometry from competing with more trustworthy physical road context.
