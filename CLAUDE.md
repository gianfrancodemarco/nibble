# Project rules

## Shipping an OpenSpec change

When asked to push or open a PR for a finished OpenSpec change, do the whole
close-out in that same branch, in this order:

1. Archive the change first (`/opsx:archive`): sync its delta specs into the
   main specs under `openspec/specs/`, then move it to
   `openspec/changes/archive/YYYY-MM-DD-<name>/`.
2. Update `docs/roadmap.html`: mark the item the change implements as done
   (`class="it done"`). If the change has no roadmap item, say so instead of
   inventing one.
3. Commit, push and open the PR, so the archive and the roadmap edit land
   with the feature instead of trailing it.
