---
name: Video scaffold controls & tsconfig baseline
description: video-js artifacts ship workspace-driven controls (WorkspaceControlledVideo, useVideoAudio, sceneMeta) that supersede the skill's manual control-bar pattern; their tsconfig needs a DOM lib override or typecheck fails out of the box.
---

Two quirks of freshly created `video-js` artifacts (observed 2026-09-06 on `artifacts/qms360-video`):

1. **Controls come from the workspace, not hand-rolled components.** The scaffold's `src/lib/video/` includes `controls.tsx` (`WorkspaceControlledVideo`), `playerBridge.ts`, `playerActions.ts`, `workspaceControls.ts`, and a `useVideoAudio()` hook. The play/pause/scene-jump/scene-lock/mute bar is rendered by the Replit workspace over postMessage — do NOT build `VideoWithControls`/`useSceneControls` from `scene-selectors.md` (that reference predates this scaffold). Post-build wiring is only: wrap `<VideoTemplate />` in `<WorkspaceControlledVideo>` in App.tsx, fill `SCENE_DETAILS` in `src/components/video/sceneMeta.ts`, and add the `<audio>` element synced via `useVideoAudio()` + scene-key seek.

2. **Typecheck baseline is red without a DOM lib.** The artifact tsconfig extends `tsconfig.base.json` which sets `lib: ["es2022"]`; scaffold files use `window`/`document`, so `pnpm run typecheck` fails until you add `"lib": ["es2022", "DOM", "DOM.Iterable"]` to the artifact's `tsconfig.json` compilerOptions.

**Why:** A code reviewer reading a git diff of a new video artifact mistakes the scaffold library for agent edits (whole dir is untracked/new) and flags the typecheck failure as introduced breakage; both are scaffold baselines.

**How to apply:** For any video artifact post-build pass, use the scaffold's bridge APIs (never edit `src/lib/video/*`), add the DOM lib override once, and treat "startRecording on every mount" as safe — remounts only happen in the iframe preview; the export path renders top-level with a single mount.
