# Building Knowledge Library — curated seed and expansion

**Status: first bounded seed and retrieval implemented, 2026-09-25; deployment and live-model evidence are recorded in the release PR.** The owner's September 20 decision supersedes the older "planned later" priority. Eight short original reference notes cover timber moisture, fastenings, renovation survey, distinct hen/rabbit requirements, electrical work planning, cutting quantities and drawer travel. They are a starting corpus, not a complete construction handbook.

`building-knowledge-seed.json` is the versioned source register and seed. Each note records publisher, edition/section, URL, jurisdiction, source kind, content hash, review date/due date and publication status. The rights mode is `original_summary_links_only`: original brief summaries and links, with no third-party passages, drawings or book text stored. This does not grant permission to ingest the linked publications. Bob-authored geometric workflow notes are labeled separately from official and industry guidance.

`search_building_knowledge` performs bounded term/prefix retrieval with Swedish/English keywords and returns at most four notes per call. Both Bob and the CAD assistant can consult it. Private, withdrawn, unapproved, not-yet-reviewed, expired and incompatible-jurisdiction notes are excluded. Unknown queries return `no_match`, not invented coverage. General reference citations appear separately from project records in the conversation. Changing a seed revision/withdrawal requires review, commit and Edge deployment; the application never auto-imports project uploads into this public seed.

No embeddings, copied handbook, global private-document store or live regulatory search is implemented. Current legal/product-sensitive decisions need the applicable current original source and actual project inputs. The 2019 fastener reference supplies conceptual orientation only, with no copied dimensioning tables or assumption that an old product/standard edition is current.

## Product contract

Bob should be a knowledgeable builder with reusable tools, not a menu of hardcoded construction recipes. General construction knowledge informs choices, materials, assembly methods, checks and explanations. Private project/building records describe this particular place. Deterministic geometry/calculations produce reproducible dimensions. None of these truth classes substitutes for the others. An embedding index retrieves material at runtime; it is not model training and cannot by itself add unsupported CAD operations.

## Remaining corpus expansion

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
