# Bob loop and drawing failures — audit and handoff (2026-10-20)

> Dated record of the 2026-10-20 "Bob flow audit" work: why Bob looped, burned
> money or failed drawings, what was fixed and released, and what is still open.
> Current behavior lives with its owners
> ([conversations](ask-bob-conversations.md), [CAD](cad-adapter.md),
> [State](bob-delivery-flow.md#state)). This file is evidence and a handoff, not a
> second current truth.

Owner direction: find root causes, no new controller AI, no hardcoded command
words in prompts, and Bob is not told about money.

## Released on 2026-10-20

All merged to `main`, with `ask-bob` and `bob-worker` deployed after each one.
New behavior is pinned per job, so jobs that were already running keep their old
contract.

| PR | Root cause found | Change |
|---|---|---|
| #292 | Context rollover thrash. The fixed tool surface was added on top of provider-reported input that already contained it, so a ~40k request counted as >64k. The chain was summarized almost every step, and Bob lost what he had read and re-read it. | `rolloverVersion: 1`: reported input counted once; a refresh happens only when the summarized part is ≥¼ of the limit. |
| #293 | Mid-job summaries and replayed history made every request large and lossy. | Complete requests and result references activated for new turns; only recent private reasoning kept. |
| #294 | No hard stop on a runaway job. | Owner-set per-job spending stop (`turn_usd_stop`, catalog metadata, pinned per job). **Temporary.** It can be removed by a DB change. |
| #295, #296 | OpenAI returns 400 on `include=reasoning.encrypted_content` when retrieving stored (`store=true`) background responses, so finished responses were not delivered. | Stored reasoning is replayed by item id, and the include-GET was removed. |
| #297 | **Loop:** results older than two exchanges became `get_work_history` references, including results Bob had just reopened. He reopened them again, about 40 times in turn `bdc9ebf6` ($1.87). **Lost answer:** when the stop hit during the completion review, the recovery template replaced Bob's answer. | `resultWindowVersion: 1`: the newest results stay whole up to 20,000 tokens. The reviewed answer is checkpointed and delivered as partial at the stop. Adds the `[CAD design failed]` log. |
| #298 | Drawing precheck failures said only "not available", with no cause logged. | Logs `[CAD dispatch guard]` and `[Construction tool unavailable]`. Spending stop lowered from 2 to 1 USD (migration `20261020133500`, owner decision). |
| #299 | **Drawing failure:** after a successful render, the CAD review request (4 preview PNGs ≈ 4×8k tokens, 2 reference images, a 83.8k-char construction check, a 20.6k-char manifest and a 12.6k-char readiness check) exceeded the 96k main ceiling. It threw `context_input_too_large`, so the drawing was reported as failed. | Specialists (non-`ask-bob` roles) get `SPECIALIST_INPUT_CEILING_TOKENS` (200,000). Bob keeps 96k. |

## Live evidence

| Job | Cost | What happened |
|---|---|---|
| `527ad00f` | $1.87 (2 USD stop) | 38 draft reads and no writes. Likely caused by lost reasoning (#296); this is unproven. |
| `bdc9ebf6` | $1.87 | `get_work_history` loop, the same result reopened 8×. Fixed by #297. |
| `a2fe443c` | $1.64 | No loop. Construction rev 9 saved (guard_h 395→350). The drawing precheck failed with "not available". |
| `101a2e82` | $0.55 | Rev 10 saved (drawer_h 205→220). Rendered once, then the review failed with `context_input_too_large`. Fixed by #299. |

After #297, a live run made 7 history calls and none were repeats. Bob's own final
answer was delivered at the stop.

Wrong theories that were ruled out:
- Catalog pin drift: all four pins were current.
- The `[CAD design failed]` path: it did not fire.

## Open — not yet verified

1. **#299 is not live-verified.** Rerun the same drawing task. Ask the deploys
   thread to snapshot `bob_job_steps` while the job runs (the journal is cleared
   at job end) and to collect log lines with `[CAD design failed]`,
   `[CAD dispatch guard]`, `[Construction tool unavailable]` or
   `context_input_too_large`.
2. **An unchanged retry returns the stored failure.** The request-level retry
   fingerprint suppresses identical retries. After a fix ships, a retry with the
   same inputs can still show the old failure until something changes.
3. **The 1 USD stop is temporary.** Decide whether to keep it, raise it or remove
   it once runs complete reliably.
4. **Per-job notebook and idle tool release** is prepared in this PR and not
   activated:
   - code inert until its catalog migration `20261020150000_ai_bob_notebook.sql`
     is applied;
   - design in [ask-bob-conversations.md](ask-bob-conversations.md);
   - affected tests pass;
   - open owner question: full notebook versus overview only, defaulting to the
     full notebook with the size cap.

   Apply the migration only after the owner has tested it. It goes through the
   deploys thread.
5. Earlier owner choice (2026-10-18), not started: replace the ~96 tool manuals
   with ~8 workflow cards, and use the freed prompt budget for judgment rather
   than rules.

## Working rules for whoever continues

- Never run `supabase db push` on Bob's project (`yuobtgoidmmmwfqenkau`). Its
  hosted migration history does not match the repo.
- Migrations and live DB reads go through the "Database deploys and migrations"
  thread.
- Deploy functions with
  `npx -y supabase@2.117.0 functions deploy <fn> --project-ref yuobtgoidmmmwfqenkau`.
- A catalog text or setting change needs a generated publication migration plus a
  fixture branch in `tests/support/ai-catalog-fixture.ts`.
- Run only the affected tests per PR. The owner runs the full suite about daily.
- The owner merges, unless she says otherwise in the thread.
