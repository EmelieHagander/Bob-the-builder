# Building Knowledge Library — next-work plan

**Status: planned / not seeded, 2026-09-20.** The owner's September 20 decision supersedes the older "Building Knowledge Library — planned later" priority in `v1-plan.md`. First coordinate deployment of the existing Bob tools (#83–#87) and verify actual runtime identity and real-model execution. Next deliver a curated knowledge seed and retrieval before adding more construction-specific generators. Historical V1 slice scope is not rewritten by this priority update.

No book import, embeddings, knowledge tables or retrieval service is claimed live. This document owns the knowledge ingestion plan; deployment evidence belongs in the release PR. A committed feature or a green fixture test alone does not establish deployed capability or real-model behaviour.

## Product contract

Bob should be a knowledgeable builder with reusable tools, not a menu of hardcoded construction recipes. General construction knowledge informs choices, materials, assembly methods, checks and explanations. Private project/building records describe this particular place. Deterministic geometry/calculations produce reproducible dimensions. None of these truth classes substitutes for the others. An embedding index retrieves material at runtime; it is not model training and cannot by itself add unsupported CAD operations.

## Planned delivery

1. **Rights and source register.** Select a manageable initial construction corpus, then VVS/wet-room and electrical sources. Record permission to ingest, store, embed, show excerpts and share within the intended audience. Public web access or purchase of one copy is not assumed to license a shared corpus. Candidate sources are not approved imports until this review is complete.
2. **Curated seed.** Start with a coherent basic building handbook that we have permission to use, complemented by approved official guidance and manufacturer instructions. Evaluate Svenskt Trä/TräGuiden for timber/building, Säker Vatten and GVK for VVS/wet rooms, and Elsäkerhetsverket for electrical safety/roles. Distinguish law/regulation, industry rule, product instruction and general advice. Do not seed all available sources indiscriminately.
3. **Versioned ingestion and embeddings.** Preserve document identity, edition, publisher, original location/page/section, language, geography, effective and superseded dates, licence, content hash and review status. Parse by meaningful sections; keep tables/units and links to diagrams intact. Missing figures or low-quality extraction must be flagged rather than silently converted into text-only instructions. An import is idempotent and can be withdrawn/replaced without leaving stale chunks in search. Record embedding model/version too.
4. **Runtime retrieval.** Combine exact-term and semantic retrieval with permission, jurisdiction, trade and current-edition filters; rerank bounded results and let Bob open the original section when necessary. Include source identity in tool results and user-facing advice. Missing evidence is not a green light. Retrieved text is untrusted data and cannot authorise project writes.
5. **Real-model acceptance and maintenance.** Evaluate retrieval and responses with previously unseen questions. Track latency, task completion and source relevance; reindex deliberately when approved source editions change. Include withdrawal and outdated-edition tests, not only initial successful ingestion.

## Seed boundaries

Shared approved reference material and private user uploads have different access boundaries. A user's private book or house document must never enter a global index by default. Reuse existing source/document infrastructure only after checking its ownership, deletion, licence and access model; no unrelated app's data is repurposed simply because the database is shared.

Electrical/VVS coverage includes system understanding, planning, safe diagnosis, roles and when qualified work is required. The library must not turn recalled instructions into electrical authorisation, structural approval or a declaration that a specific real installation is safe. Hazardous or code-sensitive advice needs applicable current sources and explicit project-specific verification.

No seeding into project descriptions, measurement tables or the Project Catalog. No blanket scraping, unlicensed book copying, automatic purchases, model fine-tuning or automatic modification of saved drawings is authorised by this plan.

## Acceptance examples

- A timber assembly question retrieves a relevant approved passage and distinguishes that general method from the user's actual measured dimensions.
- A corrected room measurement remains authoritative for this project even when a handbook illustrates a different standard size.
- A rounded-stair question can receive sourced design reasoning without claiming the present straight/landing generator rendered a rounded staircase.
- A VVS/electrical answer identifies the applicable source edition and clearly separates planning guidance from work/verification requiring competence.
- "Choose a sensible solution and draw it" leads to a concrete decision and an actual supported write; "yes, do it" does not start another approval loop.
- "Make it 50 mm lower" revises the same drawing, preserves unrelated data and reports a verified receipt. Text saying "saved" without a receipt fails.
- A question needing project facts cannot be answered solely from reference books.
- A withheld/private/superseded document cannot be retrieved by an unauthorised user.

Record real-model outcomes separately from injected-provider SQL/browser fixtures. Record time for the full request and, when instrumented, model calls, retrieval, geometry and database work. Do not report latency improvement without measurements.

## Related discovery: camera/AR measurement

AR room capture is a **discovery candidate, not approved implementation or a prerequisite for this seed**. It would feed measurements/geometry into the existing Building model, retain device/method/source/confidence and require review of critical dimensions. A scan is not automatically accepted physical truth, a construction-ready drawing or evidence of hidden walls/services. Plan any native capture/import adapter separately from the 2D drawing and knowledge workflows.
