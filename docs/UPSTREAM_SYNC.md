# Auditing upstream racing changes

Kaki Rally was extracted from the immutable source SHA in
[`SOURCE_BASELINE.md`](../SOURCE_BASELINE.md). Never sync from an unrecorded
moving branch and never perform extraction work inside the source worktree.

## Safe sync procedure

1. Resolve the intended source ref to a full SHA and record it before copying:

   ```bash
   git ls-remote https://github.com/dknos/Kaki-Survivors-2 refs/heads/main
   ```

2. Fetch that SHA into a clean temporary clone or detached worktree. Verify
   `git status --porcelain` is empty and `git rev-parse HEAD` matches.
3. Review racing-only changes first:

   ```bash
   git diff --name-status \
     3711e8fc0c2c86b27911171c5394723ceb9e45aa..<new-sha> \
     -- src/racing assets/racing
   ```

4. Recompute the dependency closure before importing shared modules. Racing is
   allowed to use only the focused adapters in `src/core/` and the retained
   renderer layer. Do not copy a newly enlarged Survivors state/config/assets
   service wholesale.
5. Port behavioral changes to `src/racing/` with the smallest necessary
   adapter expansion. Preserve save schemas and KDT code compatibility.
6. Regenerate and inspect the asset inventory:

   ```bash
   npm run assets:inventory
   git diff -- docs/ASSET_INVENTORY.json
   ```

7. Run `npm test`, the full browser matrix, and the ten-session benchmark.
   Compare handling, renderer submission, lifecycle counters, and the
   source-baseline scene rather than relying on source inspection alone.
8. Update `SOURCE_BASELINE.md` and `CHANGELOG.md` with the new SHA, imported
   directories, adapter changes, and intentional deviations.

## Merge rules

- Source and destination histories remain separate; never change or push the
  source remote.
- Do not combine an upstream sync with a physics or visual rewrite.
- Keep the legacy save keys and KDT1/KDT2 decoders unless a separately reviewed
  migration provides backward compatibility.
- Keep WebGL as the stable default until repeated WebGPU browser and hardware
  benchmarks justify a policy change.
- Catastrophe needs its Node, asset, lifecycle, replay, and repeated WebGL
  browser gates rerun before its availability flag changes.
- A green deterministic suite is not a substitute for physical touch/gamepad,
  aesthetic, or performance review.
