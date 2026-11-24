// A pull request pinned from the platform's own document (design "The target file is the
// contract", D7, D10, D11, D12, D19, D26 of review-a-teammates-pull-request-read-only).
//
// Pure: no filesystem, no git, no network. `interlock review target` reads the document
// `gh pr view --json …` or `glab mr view --output json` printed, hands it here with the
// absolute root of the person's tree, and writes what comes back. Every later command reads
// that file and checks it with `validateTarget`, the one statement of what a target is.
//
// Every `git` argv is an array built from validated values only: commit ids are full
// hexadecimal ids, a branch name is placed only under `refs/heads/`, and the pull request's
// head is fetched by its numbered ref, never by its branch name.

/** Where a review's session files live, under the person's tree. */
export const REVIEW_PR_DIR = '.claude/ship/review-pr'
/** Where a review's worktree lives, under the person's tree. */
export const REVIEW_PR_WORKTREES = '.claude/worktrees'

const PLATFORMS = Object.freeze(['github', 'gitlab'])
const COMMANDS = Object.freeze(['fetch', 'worktreeAdd', 'changed', 'worktreeRemove'])

/** A full commit id: 40 hexadecimal digits (SHA-1), or 64 (SHA-256). Lowercase, as git prints it. */
const isCommitId = v => typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v)

/**
 * Why `name` cannot be a git branch name, or null when it can. Holds the rules of
 * `git check-ref-format` that matter here: a colon would turn a fetch argument into a
 * refspec with a local destination, and whitespace, a control character or `..` cannot be
 * in a ref name at all. A leading dash is refused too, so a name never reads as an option.
 */
function refNameProblem(name) {
  if (typeof name !== 'string' || !name) return 'is not a branch name'
  if (/[\x00-\x20\x7f]/.test(name)) return 'holds whitespace or a control character'
  if (name.includes(':')) return 'holds a colon'
  if (name.includes('..')) return 'holds ".."'
  if (/[~^?*[\\]/.test(name)) return 'holds a character a ref name cannot hold'
  if (name.includes('@{') || name === '@') return 'holds "@{"'
  if (name.startsWith('-')) return 'starts with a dash'
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return 'has an empty path component'
  if (name.endsWith('.') || name.endsWith('.lock') || /(^|\/)\./.test(name)) return 'has a component a ref name cannot have'
  return null
}

const has = (doc, key) => Object.hasOwn(doc, key) && doc[key] !== undefined && doc[key] !== null

/** The first key of `keys` the document does not hold, or null. */
const firstMissing = (doc, keys) => keys.find(k => !has(doc, k)) ?? null

const refuse = reason => ({ ok: false, reason })

const positiveInt = v => Number.isInteger(v) && v > 0

/** The places and argv a target carries, from its validated parts. */
function build({ platform, number, url, draft, base, head, runCode, root, headRef }) {
  const slug = `${platform}-${number}-${head.sha.slice(0, 12)}`
  const dir = `${REVIEW_PR_DIR}/${slug}`
  const worktree = `${String(root).replace(/\/+$/, '')}/${REVIEW_PR_WORKTREES}/review-pr-${slug}`
  return {
    platform,
    number,
    url,
    draft,
    base,
    head,
    runCode: runCode === true,
    dir,
    file: `${dir}/target.json`,
    worktree,
    commands: {
      fetch: ['git', 'fetch', 'origin', `refs/heads/${base.ref}`, headRef],
      worktreeAdd: ['git', 'worktree', 'add', '--detach', worktree, head.sha],
      changed: ['git', '-C', worktree, 'diff', '--name-only', `${base.sha}...HEAD`],
      worktreeRemove: ['git', 'worktree', 'remove', '--force', worktree]
    }
  }
}

/** The refusals both readers share: branch names and commit ids, each named by the document's own field. */
function checkRefs(fields) {
  for (const [field, value] of fields.names) {
    const problem = refNameProblem(value)
    if (problem) return `${field} ${JSON.stringify(value)} cannot be a git branch name: it ${problem}`
  }
  for (const [field, value] of fields.ids) {
    if (!isCommitId(value)) return `${field} ${JSON.stringify(value)} is not a full commit id`
  }
  return null
}

function checkRoot(root) {
  return typeof root === 'string' && root.startsWith('/') ? null : 'the root must be an absolute path'
}

/**
 * A target from the document `gh pr view <ref> --json number,url,state,isDraft,
 * isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid` printed.
 *
 * @returns {{ ok: true, target: object } | { ok: false, reason: string }}
 */
export function targetFromGithub(doc, { root, runCode = false } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return refuse('the GitHub document is not a pull request object')
  const rootProblem = checkRoot(root)
  if (rootProblem) return refuse(rootProblem)
  const missing = firstMissing(doc, ['number', 'url', 'state', 'isDraft', 'isCrossRepository', 'baseRefName', 'baseRefOid', 'headRefName', 'headRefOid'])
  if (missing) return refuse(`the GitHub document holds no ${missing}, so the pull request cannot be pinned`)
  if (!positiveInt(doc.number)) return refuse(`number ${JSON.stringify(doc.number)} is not a pull request number`)
  if (typeof doc.url !== 'string' || !doc.url) return refuse('url is not a string')
  if (typeof doc.isDraft !== 'boolean') return refuse('isDraft is not a boolean')
  if (typeof doc.isCrossRepository !== 'boolean') return refuse('isCrossRepository is not a boolean, so whether the pull request is a fork is not stated')
  if (doc.state !== 'OPEN') return refuse(`pull request #${doc.number} is ${doc.state}, not open: only an open pull request is reviewed`)
  if (doc.isCrossRepository) return refuse(`pull request #${doc.number} is from a fork: fork pull requests are not reviewed`)
  const bad = checkRefs({
    names: [['baseRefName', doc.baseRefName], ['headRefName', doc.headRefName]],
    ids: [['baseRefOid', doc.baseRefOid], ['headRefOid', doc.headRefOid]]
  })
  if (bad) return refuse(bad)
  return {
    ok: true,
    target: build({
      platform: 'github',
      number: doc.number,
      url: doc.url,
      draft: doc.isDraft,
      base: { ref: doc.baseRefName, sha: doc.baseRefOid },
      head: { ref: doc.headRefName, sha: doc.headRefOid },
      runCode,
      root,
      headRef: `refs/pull/${doc.number}/head`
    })
  }
}

/**
 * A target from the document `glab mr view <ref> --output json` printed. The base is
 * `diff_refs.base_sha`, the commit GitLab's own diff starts from (D26).
 *
 * @returns {{ ok: true, target: object } | { ok: false, reason: string }}
 */
export function targetFromGitlab(doc, { root, runCode = false } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return refuse('the GitLab document is not a pull request object')
  const rootProblem = checkRoot(root)
  if (rootProblem) return refuse(rootProblem)
  const missing = firstMissing(doc, ['iid', 'web_url', 'state', 'draft', 'source_project_id', 'target_project_id', 'target_branch', 'source_branch', 'sha'])
  if (missing) return refuse(`the GitLab document holds no ${missing}, so the pull request cannot be pinned`)
  if (!positiveInt(doc.iid)) return refuse(`iid ${JSON.stringify(doc.iid)} is not a pull request number`)
  if (typeof doc.web_url !== 'string' || !doc.web_url) return refuse('web_url is not a string')
  if (typeof doc.draft !== 'boolean') return refuse('draft is not a boolean')
  if (doc.state !== 'opened') return refuse(`pull request !${doc.iid} is ${doc.state}, not open: only an open pull request is reviewed`)
  if (doc.source_project_id !== doc.target_project_id) {
    return refuse(`pull request !${doc.iid} is from a fork (source_project_id ${doc.source_project_id}, target_project_id ${doc.target_project_id}): fork pull requests are not reviewed`)
  }
  const refs = doc.diff_refs
  const baseSha = refs && typeof refs === 'object' ? refs.base_sha : undefined
  if (baseSha === undefined || baseSha === null || baseSha === '') {
    return refuse(`pull request !${doc.iid} does not state its base commit yet (diff_refs.base_sha is empty): GitLab fills it shortly after the pull request is created, so try again`)
  }
  const bad = checkRefs({
    names: [['target_branch', doc.target_branch], ['source_branch', doc.source_branch]],
    ids: [['diff_refs.base_sha', baseSha], ['sha', doc.sha]]
  })
  if (bad) return refuse(bad)
  return {
    ok: true,
    target: build({
      platform: 'gitlab',
      number: doc.iid,
      url: doc.web_url,
      draft: doc.draft,
      base: { ref: doc.target_branch, sha: baseSha },
      head: { ref: doc.source_branch, sha: doc.sha },
      runCode,
      root,
      headRef: `refs/merge-requests/${doc.iid}/head`
    })
  }
}

const isArgv = v => Array.isArray(v) && v.length > 0 && v.every(a => typeof a === 'string')

/**
 * Whether `value` is a target as the readers above write one: every field present and of
 * its shape. The one statement of what a target is; every command that takes `--target`
 * reads its file through this.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return refuse('it is not an object')
  if (!PLATFORMS.includes(value.platform)) return refuse(`platform ${JSON.stringify(value.platform)} is not one of ${PLATFORMS.join(', ')}`)
  if (!positiveInt(value.number)) return refuse('number is not a pull request number')
  if (typeof value.url !== 'string' || !value.url) return refuse('url is not a string')
  if (typeof value.draft !== 'boolean') return refuse('draft is not a boolean')
  for (const side of ['base', 'head']) {
    const part = value[side]
    if (!part || typeof part !== 'object') return refuse(`${side} is not { ref, sha }`)
    const problem = refNameProblem(part.ref)
    if (problem) return refuse(`${side}.ref ${problem}`)
    if (!isCommitId(part.sha)) return refuse(`${side}.sha is not a full commit id`)
  }
  if (typeof value.runCode !== 'boolean') return refuse('runCode is not a boolean')
  if (typeof value.dir !== 'string' || !value.dir.startsWith(`${REVIEW_PR_DIR}/`)) return refuse(`dir is not a directory under ${REVIEW_PR_DIR}`)
  if (typeof value.file !== 'string' || value.file !== `${value.dir}/target.json`) return refuse('file is not target.json inside dir')
  if (typeof value.worktree !== 'string' || !value.worktree.startsWith('/') || !value.worktree.includes(`/${REVIEW_PR_WORKTREES}/review-pr-`)) {
    return refuse(`worktree is not an absolute path under ${REVIEW_PR_WORKTREES}`)
  }
  const commands = value.commands
  if (!commands || typeof commands !== 'object') return refuse('commands is not an object')
  for (const name of COMMANDS) {
    if (!isArgv(commands[name]) || commands[name][0] !== 'git') return refuse(`commands.${name} is not a git argv`)
  }
  return { ok: true }
}
