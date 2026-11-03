# Konrad bounded construction pieces — release 2026-11-03

**Status: production runtime and catalog active; owner/model acceptance outstanding.**

- Source: [PR #422](https://github.com/EmelieHagander/Bob-the-builder/pull/422), merged into `main` as `20e878906968c6a8bf53f6ddde80cc7a936aa5d4`.
- Live Supabase project: `yuobtgoidmmmwfqenkau`, verified by the dedicated FoxAndMouse connection (`https://yuobtgoidmmmwfqenkau.supabase.co`).
- Read-only preflight showed **zero active queued/running Bob jobs**, `bob.tools.report_readback_version=1`, `construction_auto_check_version=1`; the active Konrad persona was v3 and contract v20 without the piece flag.

## Verified installation order

| Component | Hosted version | Source and contract readback |
| --- | --- | --- |
| `bob-worker` | v187 | `verify_jwt=false`, existing capability auth preserved; all 134 files read back. Three changed shared modules matched merged source byte-for-byte; all other files stayed byte-for-byte unchanged. Bundle SHA-256 `51cd68cbf5a448d09b9c2b309deda55781ee4709079246f4fd4276a37a1dca65`. |
| `ask-bob` | v219 | `verify_jwt=true` preserved; all 136 files read back, including the three exact reviewed module edits; untouched files matched the previous production bundle. Bundle SHA-256 `31e2a1eb453cce24532f3953c91082cf809dae067b0c94a880ec5fb699ad982d`. |
| `20261103142117_konrad_piece_progress_catalog.sql` | `20261103142117` | Applied only **after both Edge functions** were deployed and checked. `agent-contract.ask-bob` v21 carries `worker_piece_progress_version=1`; `structure-worker.persona` v4 carries the scoped-piece note. |

The migration tool assigned the hosted timestamp `20261103142117` instead of
the source draft `20261103140000`. The repository migration was renamed to the
**live version** with unchanged SQL so the migration history stays aligned and
the activation is not attempted twice.

## What is active

- For **newly claimed**, version-pinned Konrad work only, code executes at most
  one construction mutation per model tool-call batch. Further calls in that
  batch are deferred to a subsequent model step.
- After each such save, code immediately reopens the **exact current saved
  construction revision**, reuses the write-state check or runs the existing
  automatic check, and provides a compact technical piece result. If this
  verification fails, Konrad receives `needs_verification` and the persisted
  write receipt; the next unverified mutation is not silently attempted.
- Konrad's role instructs him to work on a natural affected opening/wall at a
  time, preserve unrelated parts and use his private workpad for next steps.
  Bob/owner still review the eventual aggregate drawing.
- Existing pinned conversations and non-Konrad worker behavior are unchanged.
  No extra mini/nano model was introduced.

## Validation and limits

- Local fixture tests: **6/6** targeted piece-progress and **19/19** existing
  worker/checkpoint/trim tests passed; `npm run typecheck` and `git diff --check`
  passed. Deno dependency checking was blocked by the network, not by a
  confirmed code error.
- **No GitHub Actions, paid model calls or full CI** were run for this release,
  per owner preference. Production acceptance remains untested.
- The backend validates revision identity and uses existing whole-construction
  checks. It **cannot yet prove from geometry** that seven distinct windows
  occupy seven correct locations, nor that any design is structurally approved.
- A fresh Ladan run should show the first saved opening revision, immediate
  exact readback/check and a continuation working on the next opening. Confirm
  eventual aggregate drawing and saved-window count with the owner. Jobs already
  started before activation retain their previous contract.

## FORM A/B v2 — uppföljande release 2026-11-03

**Status: produktionsfunktioner och v2-katalog driftsatta och verifierade; verklig
projekt-/modellacceptans återstår.** Denna uppföljning ersätter inte det
historiska v1-releasebeviset ovan.

- Källa: [PR #424](https://github.com/EmelieHagander/Bob-the-builder/pull/424),
  mergad till `main` som `f83e4cbe23ed9efc5c9622be5206c9d679288e7f`.
  GitHubs `main` jämfördes och var identisk före driftsättning.
- Mål: Supabase-projekt `yuobtgoidmmmwfqenkau`. Förkontroll och sista
  aktiveringskontroll visade 101 avslutade, 5 avbrutna och **inga pågående jobb**.
- `bob-worker` **v188**, `verify_jwt=false` oförändrat: 135/135 filer återlästa
  och exakt jämförda med planerat paket. Bundle SHA-256
  `170966deede6994e1b91ab5bef4e19fdc9cbae4eed5ac3467a0fb18dc7e40e08`.
- `ask-bob` **v220**, `verify_jwt=true` oförändrat: 137/137 filer återlästa
  och exakt jämförda. Bundle SHA-256
  `5b7d11f8440a2d7f460366b9749daadb6132cfe3fc7e8a7017436c8897387ec7`.
- Efter båda kodkontrollerna aktiverades katalogmigrationen
  `20261103155409_konrad_form_piece_evidence_catalog.sql`; dess SQL är
  oförändrad från det granskade källutkastet. Supabase tilldelade tidsstämpeln
  `20261103155409` istället för utkastets `20261103152000`; filnamnet
  synkades till den faktiska migrationshistoriken utan omkörning.
  Slutlig liveavläsning: `agent-contract.ask-bob` **v22**, publication
  `konrad-form-piece-evidence-v2`, `worker_piece_progress_version=2`;
  båda Edge-funktionerna aktiva i angivna versioner.

Det som nu är installerat för **nya, v2-pinnade Konrad-jobb** är en avgränsad
planfokusuppgift med revision, kodbaserat sparat FORM-delbevis från exakt
konstruktionsrevision, riktad kontroll där identiteten är känd och tydligt
`unknown`/paus vid otillräckligt underlag. Ingen extra mini-/nano-modell
infördes. Befintliga v1-jobb är bakåtkompatibla.

14/14 fokuserade lokala tester, `npm run typecheck` och `git diff --check`
passerade före merge. Ett orelaterat PGlite-integrationsfall var blockerat av
en äldre fixture/Claude-5.5-katalogavvikelse; detta är inte ett grönt
end-to-end-bevis. Inga GitHub Actions, betalda modellprov eller full CI kördes.
Prova Ladan och dess fönster stegvis; bekräfta varje sparad revision,
helhetsritning, krav och användarens återkoppling separat.
