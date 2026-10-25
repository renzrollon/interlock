# spec/checkpoint-advisor Specification

## Purpose

RETIRED by the change `replace-subagent-advisors-with-advisor-tool`: every requirement was removed with the checkpoint advisor subagent and no requirement remains. The original purpose follows for the record.

One stronger-model, read-only consult at the end of the spec flow that reads the whole change as the human about to review it would, and leaves its questions and risks in `openspec/changes/<change>/advisor.md` for that human. The model is bracketed by two model-free CLI steps that own every threshold, every citation check and the file it writes, so a bad draft is caught by code and a missing consult is written down rather than skipped. Nothing gates on its output.

## Requirements
