# Guided game builder

Select **New Builder** in the shared navigation, or open `/new-builder`. **Builder** opens the existing editor at `/builder`. For local testing, use an isolated server. Sign in and create a draft, or open one of your published games to work on a private revision. Publishing is a separate action.

## Walk through a build

1. Describe a small game. Review and approve the understanding, identity, logic rules, UI description, interactive tutorial, images, and schema-backed examples in order. Each example includes views before and after a move. The cover must be a text-free, widescreen SVG.
2. Revise one rule and refresh the affected steps. A regenerated artifact that matches its approved content keeps its approval. A changed proposal waits for review.
3. If test illustrations fail partway through, reopen the same draft and retry the same request. The builder reuses saved test data and completed illustrations when the prompt and approved inputs match.
4. Start the build. The worker generates and checks the server code before generating the client. Checks include deterministic calls, illustrated examples, random walks, and separate reviews of rules, private information, computer moves and payouts. Examples that use randomness verify repeatability with a fixed seed and record the skipped exact outcome.
5. Inspect the client screenshots, sampled moves and review findings. The worker can repair generated code and rerun checks. A proposed correction to an approved example needs human approval. Open the emulator and play the draft before final approval.
6. Report emulator problems using the feedback box: the model proposes the earliest affected artifact, or a regression example when the existing rules are correct. Review the before/after comparison and approve the change before rebuilding. Approved artifact cards remain in the conversation.
7. Give final approval to translate the spec, every client string and tutorial strings one language at a time. The publisher verifies complete keys and preserved placeholders; game string requests use these saved versioned translations. A retry resumes with the unfinished language. Publish to make the versioned cover, rules and tutorial available in the portal.

Closing the tab leaves the server job running. After an interruption, revisit the draft. An expired job can be retried with saved approvals and matching verified-code checkpoints. The ten-minute deadline and two concurrent builds apply per job and per server process respectively. Email and SMS completion notices require a selected channel, a verified contact and a configured sender.

## Local setup and verification

Use the repository's standard Python setup, Node dependencies, and a Playwright Chromium installation. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome. Screenshots default to `.builder-artifacts/`. For multiple serving instances, configure `BUILDER_ARTIFACT_DIR` on shared persistent storage accessible to the workers and web servers.

The server takes its provider key from private `model_api.api_key` or the `MUSE_SPARK_API_KEY` environment variable. Proposals, code generation, reviewers, artifact migration and translations call the provider. Verify the selected model's billable limits and configure `builder_input_usd_per_million`, `builder_output_usd_per_million` and `builder_max_input_tokens` in the private `model_api` section. Include image inputs when verifying the upper bound. The builder reserves the maximum configured charge before each call against a cumulative $10 per draft. Reported usage settles the reservation. Missing usage or an interrupted call leaves the reservation in place.

With the backend test environment active and Chrome installed, run:

```sh
GUIDED_BROWSER_BUILD=1 PLAYWRIGHT_CHANNEL=chrome python -m pytest -q tests/test_guided_completion.py
npx playwright test e2e/guided-builder.spec.ts
```

The HTTP test supplies model responses for a counter game and uses a real browser renderer. It exercises the seven approvals, verified build, final approval, translation plumbing and publication to an isolated test database. A separate repair test supplies a failed visual review. A live provider run is needed to assess generated game quality, real billing telemetry and translations.

## Existing games

Administrators can POST to `/admin/refactor_all_games` with `{"mode":"guided_artifacts","game_ids":["game-id"]}` and poll the returned job ID. Omit `game_ids` for the entire published catalog. Start with one game to measure provider usage. This mode fills missing private proposals for the owner to review. Restarting the migration skips artifacts already saved. Batch progress is held in process memory.

## Tutorial localization

Interactive tutorials must declare all dynamic text in `i18n-strings`, use the platform `t`/`applyLocale` helper, and handle `tutorial_locale` messages by rerendering without resetting progress. The portal sends the saved translations and language direction into the sandboxed iframe. Static tutorial text is translated as well. An older interactive tutorial without this contract must be regenerated and approved before building; approved game rules remain intact. Adding a language does not change the game's logic.

## Completion checks (November 4, 2026)

The local checks use simulated provider responses: 38 focused Python tests, including a complete real-Chrome build, and eight desktop/mobile browser checks passed. The latter cover artifact history, before/after review, emulator-feedback UI, dynamic tutorial translation, RTL and switching back to the source language while preserving progress. All 176 JavaScript tests also passed. A live Muse run and human review of its generated game are still required.
