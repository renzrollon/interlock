## A scoped re-gate: `--since <findings file>`

Without `--since` the gate reads the whole change, once. With it, the gate judges the fix rather than the whole change again, so a re-gate costs a fraction of a review and converges:

1. **Re-check each earlier blocker** in the findings file against the revised artifacts. Report each under its own title as cleared, naming the passage that now answers it, or as still open.
2. **Read only what changed since that file was written.** For a tracked change, the hunks that differ from the commit the earlier gate read (the working tree against `HEAD` when nothing was committed since):

   ```bash
   git diff -- openspec/changes/<change>/
   ```

   For a file `git status --short -- openspec/changes/<change>/` lists as untracked, the whole file. Raise a new finding only in a changed hunk or an untracked file. An unchanged passage the earlier review did not flag is not reopened.
3. **Emit and gate as below**, with the still-open blockers and the new findings in one file. A cleared blocker is left out.
