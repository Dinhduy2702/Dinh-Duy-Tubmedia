# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Tubmedia project rules

- Reply to the user in Vietnamese, short and plain (the user is not technical).
- Real user data is read-only: the installed app, `%APPDATA%\video-download-merge-studio-pro` (DB, logs), and the E: drive
  (`E:\Tubmedia`, `E:\DinhDuy`). Copy to `%TEMP%\claude\...` before reading. Never create `C:\Tubmedia`.
- Dev/e2e runs use `TUBMEDIA_E2E=1` + `TUBMEDIA_E2E_USER_DATA=<sandbox>`. Before a release also run e2e with
  `TUBMEDIA_E2E_GLOBAL_DOWNLOAD_CAP=2` (weak machine).
- Every threshold must be detected on the running machine (disk type, measured load, CPU count), never tuned to the dev machine.
- Fix flow: failing test first → fix → `npm.cmd run check` green → `node scripts/generate-source-inventory.mjs` → one commit
  per fix (message via `git commit -F <file>`).
- Pushing to `main` with a top commit `release: Tubmedia <ver>` publishes to all users. Only with the user's own typed
  confirmation; never press Re-run / Run workflow on Publish runs. Do not build the installer without permission.
- Do not kill CapCut, Chrome, or yt-dlp by name. Do not delete user files without an explicit choice. Ask before taking
  real mouse/keyboard control.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
