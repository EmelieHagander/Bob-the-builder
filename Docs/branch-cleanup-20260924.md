# Open PR reconciliation — September 24, 2026

Baseline: main `faa39a035fd91579fc53bab7bacf04245dd86014`. Nine open PRs were reviewed by actual changed files, current source and release evidence. Old branches are retained as source references; no branch history was deleted.

| PR | Disposition |
| --- | --- |
| #84 linked rooms | Closed: consolidated and deployed through #88; exact core source/migration retained in main. |
| #85 Building intake | Closed: consolidated and deployed through #88. |
| #86 multi-floor studies | Closed: consolidated and deployed through #88. |
| #87 stair studies | Closed: consolidated and deployed through #88. |
| #101 catalog aliases | Closed: #102 supersedes it; null preserves aliases/notes, [] intentionally clears aliases. |
| #95 earlier CAD architecture | Closed: current CAD engine/assistant/hosting supersedes the competing path. Exact catalog-part revision pins and instance-derived part lists retained in issue #128. |
| #106 earlier plan workspace | Closed: #107 supplies the workspace; deferred task blueprints retained in issue #129. Do not replay the conflicting old tables/RPC migration. |
| #53 early AI discovery | Closed: historical runtime audit is obsolete; ten useful outcome-evaluation families retained in issue #130 and aligned with current UC-001–005/autonomy. |
| #76 sheet-layer quantities | Closed as delivered through #131. 460 tests, three-width browser proof, hosted migration/Auth/PostgREST, Pages and exact fixture cleanup passed. [Release record](sheet-layers.md#verification-and-rollout). |

PR #88 owns the September 20 consolidated deployment evidence. Source presence and earlier fixture tests do not prove arbitrary real-model interpretation or named-member write outcomes. The original stacked PRs' 'not deployed' statements are historical.

The cleanup does not change Bob's model/prompt, shared AI path, Edge deployment or CAD runtime. The sheet-layer extension is deterministic material-planning UI/SQL; it introduces no new AI tools or automatic purchases. CAD owner testing can continue independently.
