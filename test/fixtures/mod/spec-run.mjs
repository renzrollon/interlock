// The spec flow as it crossed a hooks module on Claude Code 2.1.291
// (observe-the-spec-run-live task 1.1): the typed load of the spec skill, a
// Skill tool load of explore, an Explore spawn, and the Bash results of the
// keyed lines, the non-zero ones included (`isError`, a string `result`, and
// `text` behind an `Exit code 1` line). `skill.prompt` did not fire for a
// plugin skill on that engine, so no capture of it exists.
//
// An importable module rather than JSON because `claude plugin test` runs the
// mod's tests with no filesystem. The scrubbed captures are the JSON files
// beside this one; test/spine/mod-pins.test.mjs pins that the two are the same.

/** The change the captures name. */
export const CHANGE = 'add-a-hello-file'

/** prompt-submit-spec.json */
export const PROMPT_SPEC = {
  "origin": {
    "kind": "sdk"
  },
  "text": "/interlock:spec add a hello file --no-explore"
}

/** tool-call-skill-explore.json */
export const SKILL_EXPLORE = {
  "input": {
    "tool": "Skill",
    "skill": "interlock:explore",
    "args": "Where is the hello file specified?"
  },
  "text": "Launching skill: interlock:explore"
}

/** agent-spawn-explore.json */
export const SPAWN_EXPLORE = {
  "input": {
    "tool_use_id": "toolu_01WxDSHPSqddYnWsXXbAwSaX",
    "prompt": "In the repository at /repo, list all files under openspec/changes (recursively). Report the list of file paths. Search breadth: quick.",
    "description": "List openspec/changes files",
    "subagentType": "Explore",
    "provider": {
      "plugin": "engine",
      "tier": "core"
    },
    "parentModel": "claude-opus-5-5",
    "permissionMode": "auto",
    "background": true,
    "fork": false
  },
  "resolved": {
    "model": "claude-opus-5-5",
    "agentId": "ac8e6d020364b56af"
  }
}

/** tool-call-bash-openspec-status.json */
export const BASH_STATUS = {
  "command": "openspec status --change \"add-a-hello-file\" --json",
  "result": {
    "stdout": "{\n  \"changeName\": \"add-a-hello-file\",\n  \"schemaName\": \"spec-driven\",\n  \"planningHome\": {\n    \"kind\": \"repo\",\n    \"root\": \"/repo\",\n    \"changesDir\": \"/repo/openspec/changes\",\n    \"defaultSchema\": \"spec-driven\"\n  },\n  \"changeRoot\": \"/repo/openspec/changes/add-a-hello-file\",\n  \"artifactPaths\": {\n    \"proposal\": {\n      \"outputPath\": \"proposal.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/proposal.md\",\n      \"existingOutputPaths\": [\n        \"/repo/openspec/changes/add-a-hello-file/proposal.md\"\n      ]\n    },\n    \"specs\": {\n      \"outputPath\": \"specs/**/*.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/specs/**/*.md\",\n      \"existingOutputPaths\": [\n        \"/repo/openspec/changes/add-a-hello-file/specs/hello/spec.md\"\n      ]\n    },\n    \"design\": {\n      \"outputPath\": \"design.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/design.md\",\n      \"existingOutputPaths\": []\n    },\n    \"tasks\": {\n      \"outputPath\": \"tasks.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/tasks.md\",\n      \"existingOutputPaths\": []\n    }\n  },\n  \"isComplete\": false,\n  \"applyRequires\": [\n    \"tasks\"\n  ],\n  \"nextSteps\": [\n    \"Run openspec instructions design --change \\\"add-a-hello-file\\\" --json before writing that artifact.\"\n  ],\n  \"actionContext\": {\n    \"mode\": \"repo-local\",\n    \"sourceOfTruth\": \"repo\",\n    \"planningArtifacts\": [\n      \"proposal\",\n      \"design\",\n      \"specs\",\n      \"tasks\"\n    ],\n    \"linkedContext\": [],\n    \"allowedEditRoots\": [\n      \"/repo\"\n    ],\n    \"requiresAffectedAreaSelection\": false,\n    \"constraints\": [\n      \"Repo-local change artifacts and implementation edits are scoped to this project.\"\n    ]\n  },\n  \"artifacts\": [\n    {\n      \"id\": \"proposal\",\n      \"outputPath\": \"proposal.md\",\n      \"status\": \"done\"\n    },\n    {\n      \"id\": \"design\",\n      \"outputPath\": \"design.md\",\n      \"status\": \"ready\"\n    },\n    {\n      \"id\": \"specs\",\n      \"outputPath\": \"specs/**/*.md\",\n      \"status\": \"done\"\n    },\n    {\n      \"id\": \"tasks\",\n      \"outputPath\": \"tasks.md\",\n      \"status\": \"blocked\",\n      \"missingDeps\": [\n        \"design\"\n      ]\n    }\n  ]\n}",
    "stderr": "",
    "interrupted": false,
    "isImage": false,
    "noOutputExpected": false
  },
  "text": "{\n  \"changeName\": \"add-a-hello-file\",\n  \"schemaName\": \"spec-driven\",\n  \"planningHome\": {\n    \"kind\": \"repo\",\n    \"root\": \"/repo\",\n    \"changesDir\": \"/repo/openspec/changes\",\n    \"defaultSchema\": \"spec-driven\"\n  },\n  \"changeRoot\": \"/repo/openspec/changes/add-a-hello-file\",\n  \"artifactPaths\": {\n    \"proposal\": {\n      \"outputPath\": \"proposal.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/proposal.md\",\n      \"existingOutputPaths\": [\n        \"/repo/openspec/changes/add-a-hello-file/proposal.md\"\n      ]\n    },\n    \"specs\": {\n      \"outputPath\": \"specs/**/*.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/specs/**/*.md\",\n      \"existingOutputPaths\": [\n        \"/repo/openspec/changes/add-a-hello-file/specs/hello/spec.md\"\n      ]\n    },\n    \"design\": {\n      \"outputPath\": \"design.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/design.md\",\n      \"existingOutputPaths\": []\n    },\n    \"tasks\": {\n      \"outputPath\": \"tasks.md\",\n      \"resolvedOutputPath\": \"/repo/openspec/changes/add-a-hello-file/tasks.md\",\n      \"existingOutputPaths\": []\n    }\n  },\n  \"isComplete\": false,\n  \"applyRequires\": [\n    \"tasks\"\n  ],\n  \"nextSteps\": [\n    \"Run openspec instructions design --change \\\"add-a-hello-file\\\" --json before writing that artifact.\"\n  ],\n  \"actionContext\": {\n    \"mode\": \"repo-local\",\n    \"sourceOfTruth\": \"repo\",\n    \"planningArtifacts\": [\n      \"proposal\",\n      \"design\",\n      \"specs\",\n      \"tasks\"\n    ],\n    \"linkedContext\": [],\n    \"allowedEditRoots\": [\n      \"/repo\"\n    ],\n    \"requiresAffectedAreaSelection\": false,\n    \"constraints\": [\n      \"Repo-local change artifacts and implementation edits are scoped to this project.\"\n    ]\n  },\n  \"artifacts\": [\n    {\n      \"id\": \"proposal\",\n      \"outputPath\": \"proposal.md\",\n      \"status\": \"done\"\n    },\n    {\n      \"id\": \"design\",\n      \"outputPath\": \"design.md\",\n      \"status\": \"ready\"\n    },\n    {\n      \"id\": \"specs\",\n      \"outputPath\": \"specs/**/*.md\",\n      \"status\": \"done\"\n    },\n    {\n      \"id\": \"tasks\",\n      \"outputPath\": \"tasks.md\",\n      \"status\": \"blocked\",\n      \"missingDeps\": [\n        \"design\"\n      ]\n    }\n  ]\n}"
}

/** tool-call-bash-ledger-blocking.json */
export const BASH_LEDGER_BLOCKING = {
  "command": "interlock ledger \"add-a-hello-file\" --json",
  "result": "Error: Exit code 1\n{\n  \"change\": \"add-a-hello-file\",\n  \"path\": \"openspec/changes/add-a-hello-file/decisions.md\",\n  \"total\": 2,\n  \"needsHuman\": 2,\n  \"agentResolved\": 0,\n  \"invalidCount\": 0,\n  \"invalid\": 0,\n  \"exists\": true,\n  \"missing\": false,\n  \"unparseable\": false,\n  \"changeExists\": true,\n  \"blocking\": true,\n  \"rows\": [\n    {\n      \"id\": \"D1\",\n      \"question\": \"Which greeting?\",\n      \"class\": \"needs_human\",\n      \"resolution\": \"\",\n      \"evidence\": \"\",\n      \"line\": 5,\n      \"raw\": \"| D1 | Which greeting? | needs_human | — | — |\",\n      \"valid\": true,\n      \"problems\": []\n    },\n    {\n      \"id\": \"D2\",\n      \"question\": \"Which file name?\",\n      \"class\": \"needs_human\",\n      \"resolution\": \"\",\n      \"evidence\": \"\",\n      \"line\": 6,\n      \"raw\": \"| D2 | Which file name? | needs_human | — | — |\",\n      \"valid\": true,\n      \"problems\": []\n    }\n  ],\n  \"invalidRows\": []\n}",
  "text": "Exit code 1\n{\n  \"change\": \"add-a-hello-file\",\n  \"path\": \"openspec/changes/add-a-hello-file/decisions.md\",\n  \"total\": 2,\n  \"needsHuman\": 2,\n  \"agentResolved\": 0,\n  \"invalidCount\": 0,\n  \"invalid\": 0,\n  \"exists\": true,\n  \"missing\": false,\n  \"unparseable\": false,\n  \"changeExists\": true,\n  \"blocking\": true,\n  \"rows\": [\n    {\n      \"id\": \"D1\",\n      \"question\": \"Which greeting?\",\n      \"class\": \"needs_human\",\n      \"resolution\": \"\",\n      \"evidence\": \"\",\n      \"line\": 5,\n      \"raw\": \"| D1 | Which greeting? | needs_human | — | — |\",\n      \"valid\": true,\n      \"problems\": []\n    },\n    {\n      \"id\": \"D2\",\n      \"question\": \"Which file name?\",\n      \"class\": \"needs_human\",\n      \"resolution\": \"\",\n      \"evidence\": \"\",\n      \"line\": 6,\n      \"raw\": \"| D2 | Which file name? | needs_human | — | — |\",\n      \"valid\": true,\n      \"problems\": []\n    }\n  ],\n  \"invalidRows\": []\n}",
  "isError": true
}

/** tool-call-bash-gate-blocked.json */
export const BASH_GATE_BLOCKED = {
  "command": "interlock gate --findings .claude/metrics/review-artifacts-add-a-hello-file-20261007-120000.json --metrics add-a-hello-file --json",
  "result": "Error: Exit code 1\n{\n  \"passed\": false,\n  \"total\": 4,\n  \"malformed\": [],\n  \"dismissedCount\": 0,\n  \"droppedByQuality\": 0,\n  \"counts\": {\n    \"blocker\": 1,\n    \"warning\": 3,\n    \"suggestion\": 0\n  },\n  \"byDimension\": {\n    \"artifacts\": 4\n  },\n  \"blockers\": [\n    {\n      \"dimension\": \"artifacts\",\n      \"severity\": \"blocker\",\n      \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n      \"title\": \"No design\",\n      \"description\": \"design.md is absent.\"\n    }\n  ],\n  \"byFile\": [\n    {\n      \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n      \"findings\": [\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"blocker\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"No design\",\n          \"description\": \"design.md is absent.\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W1\",\n          \"description\": \"w1\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W2\",\n          \"description\": \"w2\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W3\",\n          \"description\": \"w3\"\n        }\n      ]\n    }\n  ],\n  \"unscoped\": [],\n  \"autonomyOutcome\": {\n    \"blockers\": 1\n  },\n  \"metrics\": {\n    \"written\": true,\n    \"path\": \"/repo/.claude/metrics/review-add-a-hello-file-2026-10-06T18-02-45-555Z.json\",\n    \"reason\": null\n  }\n}",
  "text": "Exit code 1\n{\n  \"passed\": false,\n  \"total\": 4,\n  \"malformed\": [],\n  \"dismissedCount\": 0,\n  \"droppedByQuality\": 0,\n  \"counts\": {\n    \"blocker\": 1,\n    \"warning\": 3,\n    \"suggestion\": 0\n  },\n  \"byDimension\": {\n    \"artifacts\": 4\n  },\n  \"blockers\": [\n    {\n      \"dimension\": \"artifacts\",\n      \"severity\": \"blocker\",\n      \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n      \"title\": \"No design\",\n      \"description\": \"design.md is absent.\"\n    }\n  ],\n  \"byFile\": [\n    {\n      \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n      \"findings\": [\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"blocker\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"No design\",\n          \"description\": \"design.md is absent.\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W1\",\n          \"description\": \"w1\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W2\",\n          \"description\": \"w2\"\n        },\n        {\n          \"dimension\": \"artifacts\",\n          \"severity\": \"warning\",\n          \"file\": \"openspec/changes/add-a-hello-file/proposal.md\",\n          \"title\": \"W3\",\n          \"description\": \"w3\"\n        }\n      ]\n    }\n  ],\n  \"unscoped\": [],\n  \"autonomyOutcome\": {\n    \"blockers\": 1\n  },\n  \"metrics\": {\n    \"written\": true,\n    \"path\": \"/repo/.claude/metrics/review-add-a-hello-file-2026-10-06T18-02-45-555Z.json\",\n    \"reason\": null\n  }\n}",
  "isError": true
}

/** tool-call-bash-validate-unresolved.json */
export const BASH_VALIDATE_UNRESOLVED = {
  "command": "interlock validate \"no-such-change\" --json",
  "result": "Error: Exit code 1\n{\n  \"error\": \"change \\\"no-such-change\\\" not found under openspec/changes/\",\n  \"candidates\": [\n    \"add-a-hello-file\"\n  ]\n}",
  "text": "Exit code 1\n{\n  \"error\": \"change \\\"no-such-change\\\" not found under openspec/changes/\",\n  \"candidates\": [\n    \"add-a-hello-file\"\n  ]\n}",
  "isError": true
}

/** tool-call-bash-ledger-text.json */
export const BASH_LEDGER_TEXT = {
  "command": "interlock ledger \"add-a-hello-file\"",
  "result": "Error: Exit code 1\nDECISIONS BLOCKING — 2 row(s): 2 needs_human, 0 agent_resolved, 0 invalid\n  [needs_human] D1: Which greeting?\n  [needs_human] D2: Which file name?",
  "text": "Exit code 1\nDECISIONS BLOCKING — 2 row(s): 2 needs_human, 0 agent_resolved, 0 invalid\n  [needs_human] D1: Which greeting?\n  [needs_human] D2: Which file name?",
  "isError": true
}
