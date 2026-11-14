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
3. Update the user guide under `docs/guide/`: every behaviour the change
   adds or alters that a reader or an agent can see must be described in
   the chapter it belongs to (getting started, receiving, reading, answering
   or agents), and anything the guide still marks as "coming" that the
   change ships must lose that mark. If the change is invisible to users
   (internal refactor, CI, tests), say so instead of editing the guide.
4. Commit, push and open the PR, so the archive, the roadmap edit and the
   guide update land with the feature instead of trailing it.
