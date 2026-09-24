# bob — current user stories

> **Status:** current product contract for user goals and acceptance intent  
> **Scope:** planning a build, preparing it, doing it together, and learning from what actually happened  
> **Priority:** the five outcome use cases below are the product acceptance baseline, confirmed 2026-09-24. Existing feature stories serve these outcomes; a finished technical slice is not a finished use case.

This document is the current owning home for bob's user stories. It preserves the original BuildCoord collaboration thesis while extending bob into the workflow that has emerged through real use: **show bob the real project → understand it → measure it → choose a solution → produce buildable information → calculate what is needed → organise the work and people → build → document what actually happened**.

The historical `Docs/Mockups and initial plans/BuildCoord_PRD.md` remains useful prior art and product history. Where user-story wording conflicts, this document is the current story contract; the original PRD is not rewritten retroactively.

## Product mandate — 2026-09-24

**Bobs främsta uppgift är att göra det möjligt att gå från idé till genomfört byggprojekt utan tidigare byggkunskap.** Den andra bärande uppgiften är att göra stora byggen snabbare, roligare och mer tillgängliga genom att organisera människor över flera dagar. Information, mockups och hjälpbilder hör hemma där de behövs i arbetet. Användaren och Bob ska båda kunna skapa och koppla sådant underlag till rätt steg.

Bob är byggexperten och driver det delegerade arbetet. Projektledaren anger mål, ändrar riktning och bidrar med observationer på plats. Bob gör rimliga reversibla arbetsval, sparar dem med rätt ursprung och fortsätter till ett användbart resultat. Han ber om hjälp när en fysisk observation, ett faktiskt saknat mandat eller ett avgörande ägarbeslut behövs. Han kan inte mäta, inspektera eller bygga på distans. Ett uppskattat mått får användas som uppskattning i konceptarbete, men blir inte uppmätt för att Bob har sparat det.

**Promptstrategi:** en kort sammanhängande roll, allmänna principer och verktygskontrakt. Inga objektspecifika manus eller allt längre listor av tidigare incidenter. Humor får färga rösten; den ersätter inte funktion. Huvud-Bob använder en standardmodell med reasoning **high** via den gemensamma AI-vägen. Assistent- och minnesuppgifter har egna modellinställningar.

Denna precisering ersätter äldre formuleringar som kräver ett nytt godkännande för varje vanlig arbetsändring. Den avskaffar inte projektbehörighet, revisionskontroll, synlig osäkerhet eller uttryckliga beslut där de faktiskt behövs. Ändrade produktkrav är inte bevis på ändrad runtime.

### BOB-UC-001 — Från idé till genomfört bygge utan förkunskaper

**Användarberättelse:** Som projektledare vill jag kunna gå från idé till genomfört byggprojekt utan tidigare byggkunskap, för att minska tröskeln för att göra saker själv.

**Start:** ett önskemål i vanligt språk, eventuellt med bilder och ofullständiga mått. Användaren behöver inte känna till byggtermer, rätt verktygsnamn eller datamodellen.

**Huvudflöde:** Bob läser aktuellt projekt och tidigare samtal, förklarar en lämplig väg och gör nödvändiga arbetsval. Han bygger en levande plan, tar fram underlag, material och genomförbara uppgifter, och leder användaren genom nästa steg. Nya mått och verkliga resultat förändrar samma projekt. Arbetet avslutas med dokumenterat resultat och eventuella återstående kontroller.

**Acceptans:**
- En vanlig beställning omfattar sina normala förberedelser. Bob fortsätter över flera verktygsanrop och efter ett vanligt ”fortsätt” utan att be om samma mandat igen.
- Kända mått och tidigare rättelser används även om de ligger långt bak i chatten eller efter första sidan projektdata.
- Bob kan lägga till, uppdatera och ta bort inaktuella mått ur aktiv användning. Borttagning bevarar historik och visar berörda ritningar/krav; uppskattningar blir aldrig mätningar genom denna hantering.
- Saknad fysisk kontroll ligger kvar som en tydlig uppgift. Oberoende planering fortsätter under tiden.
- En generisk rit-/sammanställningsförmåga kan representera olika konstruktioner med delar, material och relationer. Samma förmåga ska klara exempelvis en våningssäng och en hylla utan nya objektspecifika verktyg. Exemplen är provfall, inte en tillåten objektlista.
- Ändrade mått kan följas till berörda vyer, delar, materialbehov och steg. Bob återöppnar sparat underlag efter omladdning och fortsätter nästa dag.
- ”Färdigt” kräver genomfört arbete och relevanta kontroller; skapad plan eller uppgiftslista räcker inte.

**Avvikelseväg:** motstridiga mått, otillräckligt underlag, resursgräns eller saknad förmåga redovisas som just det. Bob förklarar det verkliga hindret och driver den del som fortfarande går att utföra. Ett tekniskt fel får inte döpas om till att användaren måste godkänna igen.

**Verifieringsscenario:** en nybörjare beskriver en våningssäng, rättar ett tidigare arbetsmått, lämnar appen och återkommer. Följ hela kedjan till underlag, arbete och dokumenterat resultat. Upprepa med en annan konstruktion för att avslöja objekthårdkodning. Relaterade stories: 001–037, 049–058.

### BOB-UC-002 — Organisera ett större bygge över flera dagar

**Användarberättelse:** Som projektledare vill jag kunna ta på mig stora projekt och organisera människor över flera dagar för att göra byggprojekt snabbare, roligare och mer tillgängliga.

**Huvudflöde:** projektledaren beskriver målet och byggdagarna. Deltagare anmäler tillgänglighet och erfarenhet. Arbete, beroenden, verktyg, material och lämplig handledning fördelas över dagarna. Varje deltagare får en begriplig dagsvy. Verklig närvaro och färdiga/återstående moment ligger till grund för nästa dag.

**Acceptans:**
- Ett flerdagarsprojekt kan planeras med personer som bara deltar vissa dagar och med olika erfarenhet. Fördelningen uppdateras när någon får förhinder.
- En ny deltagare ser vad, var, med vem och med vilka förberedelser arbetet ska göras, samt hittar anvisningar och bilder direkt där.
- Uppgifter med saknade material eller beroenden framställs inte som startklara. Mindre erfarna deltagare får lämpliga uppgifter och handledning.
- Ej slutfört arbete följer med till nästa dag utan att förlora ansvar, kontroller eller dokumentation. Gjort arbete görs inte ogjort av en omplanering.
- Volontärer kan delta med namn enligt befintlig gästmodell; ett nytt konto är inte ett villkor för den avsedda volontärvägen. Mat och allergier hanteras när projektet har mat.

**Verifieringsscenario:** tre byggdagar, blandad erfarenhet, en avbokning och en materialförsening. Följ inbjudan, planering, deltagarvy, rapportering och omplanering. Relaterade stories: 038–048, 053, 059.

### BOB-UC-003 — Se rätt information och bild vid rätt steg

**Användarberättelse:** Som användare vill jag smidigt kunna se information, mockups och hjälpbilder i relation till de steg de är till för.

**Huvudflöde:** användaren öppnar ett arbetssteg och ser dess förklaring och relevanta underlag. Originalbild eller ritning kan öppnas, förstoras och förstås utan att söka i en gammal chatt. Samma underlag kan användas i flera steg.

**Acceptans:**
- Rätt version visas och syftet framgår: nuläge, förslag, måttsatt underlag, instruktion eller faktiskt resultat.
- Steganknytningen överlever navigation, omladdning och omplanering som bevarar stegets identitet.
- Uppdaterat eller inaktuellt underlag går att skilja åt. Borttagna filer och bruten åtkomst visas ärligt.
- Flödet fungerar på mobil och inom deltagarens rättigheter, även i avsedd volontärvy.

**Verifieringsscenario:** deltagaren öppnar samma steg från projektets plan och sin arbetsuppgift, använder en hjälpbild och återkommer efter att bilden fått en ny version. Projektplanens Step och uppgiftens instruktionsteg är olika identiteter; implementationen måste uttryckligen visa vilken länk som används. Relaterade stories: 003–005, 016, 032–037, 050–051.

### BOB-UC-004 — Projektledaren lägger underlag där det behövs

**Användarberättelse:** Som projektledare vill jag smidigt kunna lägga till information, mockups och hjälpbilder i relation till de steg de är till för.

**Huvudflöde:** från relevant steg skriver projektledaren information, laddar upp nytt underlag eller väljer ett redan sparat. Syfte och stegkoppling sparas tillsammans så att nästa deltagare hittar dem.

**Acceptans:**
- Både befintliga och nya bilder/filer kan kopplas till ett steg; återanvändning kräver ingen duplicerad uppladdning.
- Information och länkar kan ändras eller tas bort utan att oavsiktligt radera andra stegs underlag.
- Misslyckad uppladdning eller koppling ger ett tydligt återhämtningsbart resultat. Ingen lyckad uppladdningsetikett ersätter en faktiskt sparad fil och länk.
- Sparat underlag syns på avsedd plats efter omladdning och för behöriga deltagare.

**Verifieringsscenario:** ladda upp en fotoanvisning, återanvänd den i två steg, byt koppling i ett steg och kontrollera båda vyerna efter omladdning. Relaterade stories: 003–004, 049–051.

### BOB-UC-005 — Bob skapar och placerar användbart underlag

**Användarberättelse:** Som projektledare vill jag att AI ska kunna skapa och lägga till information, mockups och hjälpbilder smidigt i relation till de steg de är till för.

**Huvudflöde:** inom det delegerade arbetet upptäcker Bob att en förklaring, mockup, ritning eller hjälpbild behövs. Han läser relevanta källor, använder rätt genereringsförmåga, sparar resultatet och kopplar det till rätt steg. Svaret pekar på resultatet där användaren arbetar.

**Acceptans:**
- Text, illustrativa bilder och beräknad ritgeometri använder lämpliga förmågor. En illustrativ bild blir inte en måttsatt ritning genom sin etikett.
- Resultatet har faktiskt innehåll, projektkoppling, rätt steglänk, syfte, ursprung och relevanta käll-/versionsreferenser.
- Bob kan revidera samma underlag efter återkoppling och visar vilka steg som påverkas.
- ”Jag lade in det” kräver kvitto för både sparande och koppling. Om generering lyckas men koppling misslyckas behålls resultatet för säker återhämtning; nästa försök ska inte skapa blinda dubbletter.
- En deltagare hittar resultatet efter omladdning utan att öppna Bobs privata chatt. Generering utanför appen med manuell överföring uppfyller inte detta flöde.

**Verifieringsscenario:** Bob skapar en monteringsförklaring och hjälpbild vid rätt steg, sparar och kopplar dem; en annan behörig deltagare använder dem. Prova ändrad källa och avbrutet sparande. Relaterade stories: 012–018, 032–037, 056.

### Release acceptance and current gaps

**Status 2026-09-24:** alla fem är **PARTIAL**, inte slutverifierade. Manuella delytor och backendgrunder finns, men hela kedjan och AI-handlingsytan saknas på flera ställen. Den daterade [kontextauditen](bob-context-audit-2026-09-24.md) är en baslinje före korrigeringarna, inte en levande statuslista.

| Use case | Viktig kvarvarande lucka | Ansvarig kontraktsyta |
|---|---|---|
| UC-001 | CAD-hosting och verifierat genomförandeflöde; arkivering och generell CAD-integration finns på korrigeringsbranchen | `ask-bob-conversations.md`, `project-facts.md`, `living-project-plan.md`, `material-assembly-use-case.md`, `cad-adapter.md` |
| UC-002 | Sammanhängande planering/omplanering av personer och dagar via Bob samt verifierad deltagarkedja | stories 038–048, `living-project-plan.md` |
| UC-003 | Enhetlig konsumtion av rätt underlag vid både projektplanens steg och uppgifternas instruktioner | `media-and-steps.md`, `living-project-plan.md` |
| UC-004 | Komplett hantering av text/media/länkar i de avsedda stegytorna | `media-and-steps.md` |
| UC-005 | Generering → lagring → steglänk implementerat på korrigeringsbranchen; verklig modell-/deltagaracceptans återstår | `media-and-steps.md`, `artifacts.md`, `cad-adapter.md` |

En implementation ska ange vilket UC och vilket observerbart delresultat den levererar. Ett helt UC får markeras BUILT först efter dokumenterat test av huvudflöde, viktig felväg, återbesök och rätt användarroll. Databasfixturer bevisar mekanik; verkliga modellkörningar och användarflöden behövs för beteende och slutnytta. En specialgenerator, schemaändring eller lyckad API-körning ensam stänger inget UC.

## Story status legend

Implementation status is a snapshot of the current repository, not a priority judgement.

- **BUILT** — the user goal is materially supported today.
- **PARTIAL** — bob already has part of the concept/flow, but not the full story below.
- **NEW** — the story is not materially implemented yet.

## Personas

### Project owner / organiser
Owns the desired result and usually holds the broadest context. May be a DIY homeowner working mostly alone or an organiser coordinating many helpers. Needs to move from a fuzzy idea to a trustworthy, executable plan without becoming a construction-management professional.

### Skilled builder / crew lead
Has practical experience or trade knowledge. Wants precise scope, dimensions, dependencies, tools/material readiness and a clear target. Should be able to lead less experienced helpers without having to reconstruct the whole plan verbally.

### General helper
Wants to contribute but has limited construction experience. Needs safe, appropriate tasks, obvious next actions and more detailed guidance only when needed.

### Drop-in helper
May only join for one build day. Needs extremely fast context: what is happening, what can I do, who am I with, what do I need, and where do I start?

### Food coordinator
Needs the real attendance picture, dietary/allergy information, meal plan and shopping requirements without needing to care about construction details.

### Bob
Bob is the remote building expert and project-driving assistant. He investigates, decides ordinary working details and executes delegated work across tools, while preserving uncertainty, provenance and the owner's ability to change direction. He cannot perform physical site work or turn an estimate into measured truth. The product mandate above owns this distinction.

---

# Epic A — Start from the real project, not a blank form

## BOB-US-001 — Start a project from photos and plain language

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to upload photos of how things look today and describe in my own words what I want to change, so that bob can begin helping before I know all the construction terminology or measurements.

**Acceptance criteria**
- The user can create a project with a free-text goal and one or more current-state photos.
- The original uploads remain available after leaving and returning to the project.
- Bob can use the description and photos as project context without requiring a complete structured form first.
- Bob does not claim measurements or construction facts that were not provided or reliably established.

## BOB-US-002 — Keep current state separate from desired state

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to keep "what exists today" separate from "what we want to build", so that an idea, mockup or proposal is never mistaken for an existing fact.

**Acceptance criteria**
- Media and notes can be classified at least as **current state**, **proposal/target**, or **construction guidance**.
- Bob's summaries distinguish existing construction from planned changes.
- A generated mockup never silently becomes an as-built record.
- The current target can change without erasing the captured current state.

## BOB-US-003 — Keep all project media in one useful library

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want current-state photos, mockups, cut-through diagrams, measured drawings, reference images and progress photos stored in one project, so that the visual knowledge of the build is not scattered across chats and phones.

**Acceptance criteria**
- Real image/file content is stored, not only a text label.
- Every media item has a stable project association and may additionally belong to an area and/or task.
- Media has a visible type/purpose, such as current photo, target mockup, section, drawing, progress photo or task guidance.
- Media remains discoverable after navigation/reload.

## BOB-US-004 — Show the right image where the work happens

**Status:** NEW  
**Persona:** Any builder/helper

**Story**  
As a person doing a task, I want the relevant drawing, mockup or construction image available directly from that task, so that I do not have to search the whole project while working.

**Acceptance criteria**
- A task can reference one or more project media items.
- The task surface shows the most relevant media without requiring a separate library search.
- A floor build-up task can expose its floor section; a wall-framing task can expose its framing diagram; a finish task can expose the selected target image.
- The same media may be reused by several tasks without duplicate uploads.

## BOB-US-005 — Return later without losing the project story

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to return days or weeks later and continue from the same project truth, so that bob becomes the memory of the build rather than another temporary conversation.

**Acceptance criteria**
- Project decisions, measurements, media, tasks and material state that are promised as saved survive a normal return/reload in live mode.
- Bob can summarise the current project state from persisted project data.
- The user can see what is still unknown or undecided.

## BOB-US-006 — Ask for missing evidence instead of guessing

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to tell me which photo, measurement or fact it needs next, so that I can collect useful evidence instead of receiving a confident guess.

**Acceptance criteria**
- Bob can identify a missing input that blocks or materially weakens the requested next output.
- The request is concrete, e.g. "measure finished floor to underside of beam" or "photograph the support below this edge".
- Missing information remains visibly unknown until supplied.
- Supplying the requested evidence updates the relevant project context rather than creating an unrelated note.

---

# Epic B — Establish measurements and existing conditions

## BOB-US-007 — Store measurements with provenance

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a project owner, I want to record measurements together with how they were obtained, so that a measured dimension is distinguishable from an estimate taken from a photo.

**Acceptance criteria**
- A measurement records value, unit and what it measures.
- A measurement records a source/state such as **measured by user**, **provided specification**, **estimated**, or **unknown**.
- Estimated values remain visibly estimated wherever they are used.
- A later verified measurement can supersede an estimate without destroying the earlier provenance.

## BOB-US-008 — Give me the measurement checklist for the next deliverable

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to tell me exactly which dimensions are required before it can produce the next drawing or calculation, so that I know what to measure on site.

**Acceptance criteria**
- The checklist is specific to the requested deliverable and selected solution.
- Already-known verified measurements are not requested again unnecessarily.
- Required and optional/useful measurements are distinguishable.
- The user can mark/requested measurements as captured and see what remains.

## BOB-US-009 — Record what can be reused from the existing build

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a project owner, I want to record existing structural parts, doors, windows and other components that may be retained, so that bob plans an alteration rather than assuming a complete rebuild.

**Acceptance criteria**
- Existing items can be recorded with description, dimensions/specification when known, quantity and condition/uncertainty.
- An item can be marked **reuse**, **inspect before reuse**, **remove**, or **replace**.
- Plans/material calculations can reference reused items.
- Bob does not treat "looks reusable in a photo" as verified structural suitability.

## BOB-US-010 — Record materials and tools we already have

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to tell bob what materials, components and tools we already own, so that shopping and build-day preparation reflect reality.

**Acceptance criteria**
- Existing stock can be recorded separately from items that still need purchasing.
- Quantity/unit can be recorded where meaningful.
- Project-owned components such as windows can be linked to the design/task that uses them.
- Existing stock is deducted or accounted for in the shopping requirement rather than duplicated as "to buy".

## BOB-US-011 — Block precision when prerequisites are still unknown

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to warn me when a requested "exact" drawing or quantity still depends on an unverified condition, so that polished output does not create false certainty.

**Acceptance criteria**
- Bob can distinguish "enough information for a concept" from "enough information for a measured/buildable output".
- Blocking unknowns are listed before the output is labelled build-ready.
- The user may still request a conceptual draft, but assumptions are visible on that draft.

---

# Epic C — Explore, compare and choose a solution

## BOB-US-012 — Visualise a proposed change on my real project

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to create visual proposals based on my project photos and known dimensions, so that I can understand how a change may look before committing to it.

**Acceptance criteria**
- The user can select a current-state photo as the visual source.
- Known dimensions and specified components are supplied to the visualisation workflow where possible.
- The result is stored as a proposal/mockup, not as current-state evidence.
- The proposal keeps a link to the project/version/inputs that produced it.

## BOB-US-013 — Preserve real component proportions in proposals

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want a proposal using my 118 x 170 cm window to respect that actual aspect ratio and the known wall dimensions, so that the image is useful for judging proportion rather than generic decoration.

**Acceptance criteria**
- A known component dimension is passed as a constraint, not merely described as "large" or "small".
- The proposal is labelled illustrative when perspective/image generation prevents measured accuracy.
- If visual output materially violates a known dimension, the user can flag/regenerate rather than having the wrong image become the selected target.

## BOB-US-014 — Compare alternatives without losing earlier options

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to compare alternative layouts or construction approaches, so that I can make a deliberate choice rather than overwrite the previous idea every time we explore something new.

**Acceptance criteria**
- Two or more proposals may coexist.
- Each proposal has a short rationale/description and its key assumptions.
- One proposal may be marked as the current preferred/selected solution.
- Choosing one does not delete the other alternatives.

## BOB-US-015 — Mark a solution as the target everyone builds toward

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to approve one solution as the current target, so that drawings, material calculations, tasks and helpers all refer to the same intended result.

**Acceptance criteria**
- A proposal/solution has an explicit **selected/current target** state.
- Downstream planning can reference the selected solution version.
- Changing the selected solution clearly identifies downstream information that may now be stale.

## BOB-US-016 — Explain assemblies with cut-through diagrams

**Status:** NEW  
**Persona:** Project owner / general helper

**Story**  
As a user, I want a cut-through image of assemblies such as the floor or wall with the layers identified, so that I understand how the solution is physically built before I start.

**Acceptance criteria**
- The diagram shows the relevant layers/parts in construction order.
- The explanation distinguishes purpose (e.g. structure, insulation, wind protection) from decorative finish.
- The diagram can be saved as project guidance and linked to relevant tasks.
- Assumed dimensions/materials are labelled rather than presented as measured facts.

---

# Epic D — Turn the selected solution into buildable drawings

## BOB-US-017 — Ask for all required inputs before producing a measured drawing

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a project owner, I want bob to gather the measurements and existing-condition information required for a real drawing, so that the drawing is based on the site rather than invented geometry.

**Acceptance criteria**
- Bob produces a missing-input checklist for the requested drawing type.
- The user can see which inputs are verified, assumed or missing.
- Bob does not label the drawing build-ready while required inputs are missing.

## BOB-US-018 — Produce a measured drawing package from project truth

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a project owner, I want bob to produce useful plan/elevation/section drawings from the selected solution and verified dimensions, so that the build can be communicated and prepared consistently.

**Acceptance criteria**
- Drawings use the selected solution and current measurement set.
- Important dimensions are shown with units.
- Reused vs new elements can be distinguished where relevant.
- Each drawing has a revision/version and date/source context.

## BOB-US-019 — Show assumptions directly on drawings

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a builder, I want any assumed or estimated dimension clearly marked on the drawing, so that I know what must be checked before cutting or fixing material.

**Acceptance criteria**
- Verified and assumed dimensions are visually distinguishable or explicitly annotated.
- A drawing can list unresolved checks.
- Replacing an assumption with a verified measurement produces a new revision rather than silently rewriting history.

## BOB-US-020 — Keep drawings, material quantities and tasks connected

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want the material list and work plan to reference the same geometry/solution as the drawings, so that changing a dimension does not leave three contradictory versions of the project.

**Acceptance criteria**
- A drawing/material calculation/task plan records which solution revision it was derived from.
- A material geometry change can flag affected calculations/tasks as needing refresh.
- The user can see which outputs are current versus stale.

---

# Epic E — Know exactly what we need before the build day

## BOB-US-021 — Generate a bill of materials from the actual plan

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to derive the project material requirements from the selected construction and dimensions, so that the shopping list represents what we are actually building.

**Acceptance criteria**
- Material requirements can be tied to an area/task and a plan/solution revision.
- Quantity and unit are explicit.
- Existing/reused stock is accounted for separately from new purchase need.
- The list can be regenerated/updated when geometry or construction choices change.

## BOB-US-022 — Include fixings and consumables, not only big materials

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to calculate nails, screws, fasteners, membranes, paint and other consumables as well as timber and boards, so that small missing items do not stop the work.

**Acceptance criteria**
- Consumables can be derived from the relevant construction/task rather than entered only as vague manual notes.
- The quantity includes a stated calculation basis or rule.
- If an exact count is not supportable, bob provides a calculated requirement plus explicit allowance/assumption instead of fake precision.

## BOB-US-023 — Explain how every calculated quantity was produced

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a user, I want to inspect how bob calculated a material quantity, so that I can verify or correct the assumptions before purchasing.

**Acceptance criteria**
- A calculated item can expose inputs such as length/area, spacing, layers, pack size, coverage and waste allowance.
- User-entered/verified inputs are distinguishable from bob assumptions.
- Changing an input updates the derived quantity rather than requiring an unrelated manual override.

## BOB-US-024 — Account for waste, pack sizes and practical purchase quantities

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to convert theoretical quantities into practical purchase quantities, so that I know what to actually put in the cart.

**Acceptance criteria**
- Theoretical need and purchase need may be shown separately.
- Waste allowance is explicit and adjustable where appropriate.
- Pack/board/length rounding is visible rather than hidden.
- The calculation does not subtract reusable stock unless the user has confirmed its usable quantity.

## BOB-US-025 — Use what we already own before adding to shopping

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to match required materials/components against existing stock, so that we buy only the shortfall.

**Acceptance criteria**
- Required, already available and remaining-to-buy quantities are visible.
- A reused component can be reserved for a specific task/area.
- If existing stock is uncertain or damaged, it is not automatically treated as available.

## BOB-US-026 — Maintain one checkable materials shopping list

**Status:** BUILT / PARTIAL for calculated integration  
**Persona:** Project owner / shopper

**Story**  
As a shopper, I want one consolidated, checkable materials list grouped sensibly, so that I can buy for the project without reconstructing requirements from each task.

**Acceptance criteria**
- Items can be marked needed/ordered/delivered or equivalent current statuses.
- The list remains filterable/groupable by useful context such as category/area.
- Calculated requirements and manually added items can coexist without becoming indistinguishable.
- Changes persist in live mode.

## BOB-US-027 — Show tools required for each task and build day

**Status:** NEW  
**Persona:** Project owner / crew lead

**Story**  
As a project owner, I want each task and build day to show the tools required, so that the right equipment is on site before people arrive.

**Acceptance criteria**
- A task can list required tools separately from consumable materials.
- The build-day plan can consolidate tools across scheduled tasks.
- Tools may be marked already available / needs bringing / needs renting or equivalent.

---

# Epic F — Turn the plan into an executable work sequence

## BOB-US-028 — Generate a logical ordered work plan

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want bob to break the selected solution into a sensible sequence of work, so that I know what happens first, what can happen in parallel and what must wait.

**Acceptance criteria**
- The plan is split into understandable tasks grouped by area/work phase.
- Tasks are ordered based on construction dependencies, not only manually sorted labels.
- The organiser can edit/replace bob's proposed task breakdown.
- Changes to the chosen construction can cause affected tasks to be reviewed rather than silently staying unchanged.

## BOB-US-029 — Represent task dependencies explicitly

**Status:** NEW  
**Persona:** Project owner / crew lead

**Story**  
As a crew lead, I want to see that a task depends on earlier work, so that helpers do not start something that will need to be removed or redone.

**Acceptance criteria**
- A task may depend on one or more other tasks/checkpoints.
- Blocked-by-dependency state is distinguishable from "not started".
- Build-day planning can identify tasks that are not actually startable yet.

## BOB-US-030 — Make every task a practical work card

**Status:** PARTIAL  
**Persona:** Any builder/helper

**Story**  
As a person doing the work, I want each task to tell me what to do, what I need, how long it may take, how difficult it is and what the target looks like, so that I can prepare before starting.

**Acceptance criteria**
- A task can show: title, short outcome/description, area, estimated duration, skill/difficulty, assignees, materials, tools and relevant media.
- The task shows whether its prerequisites/materials are ready where that information exists.
- The compact card remains useful without requiring the full detailed guide to be open.

## BOB-US-031 — Use project-specific dimensions inside task instructions

**Status:** NEW  
**Persona:** Skilled builder / general helper

**Story**  
As a builder, I want a task such as "frame the window opening" to use the dimensions of our actual wall and window, so that the task is tied to this build rather than a generic tutorial.

**Acceptance criteria**
- The task can reference verified project measurements/components.
- Project-specific values are distinguished from generic recommended clearances/rules.
- If a required project dimension is unknown, the task asks for/flags it rather than filling it with an invented number.

## BOB-US-032 — Show whether a task is ready to start

**Status:** PARTIAL  
**Persona:** Project owner / crew lead / helper

**Story**  
As a builder, I want to know whether a task is actually ready, so that I do not arrive at a job that is blocked by missing materials, unfinished prerequisites or missing information.

**Acceptance criteria**
- Readiness can account for dependencies, materials and required information.
- Missing prerequisites are named.
- "Ready" is not inferred merely because the task exists.

## BOB-US-033 — Let the organiser change the generated work plan

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As an organiser, I want to edit, add, remove and reassign proposed tasks, so that bob supports the real build rather than forcing an AI-generated plan.

**Acceptance criteria**
- Bob-generated tasks are editable like human-created tasks.
- Human changes are not silently overwritten by a later AI refresh.
- Bob can propose a plan update and show what would change before consequential replacement.

## BOB-US-034 — Ask "How do I?" only when I need more detail

**Status:** NEW  
**Persona:** General helper / drop-in helper / skilled builder

**Story**  
As a person doing a task, I want a **How do I?** action that expands the task into practical step-by-step guidance, so that the main task view stays simple while help is available on demand.

**Acceptance criteria**
- The normal task card remains concise.
- "How do I?" opens guidance in the context of the current task/project.
- Guidance uses known project-specific dimensions/materials where relevant.
- The detailed guide can be added later without changing the basic task model.

## BOB-US-035 — Show what the construction should look like during the task

**Status:** NEW  
**Persona:** General helper / skilled builder

**Story**  
As a builder, I want a task-specific image showing the construction at the stage I am creating — for example a framed wall before cladding — so that I can compare what is in front of me with the intended intermediate result.

**Acceptance criteria**
- Guidance media represents the relevant construction stage, not only the polished finished result.
- Important components can be labelled where useful.
- The image is linked to the task and its solution revision.
- Illustrative geometry is not presented as a measured drawing unless it truly is one.

## BOB-US-036 — Give me control points before I hide the work

**Status:** NEW  
**Persona:** Skilled builder / general helper

**Story**  
As a builder, I want a short checklist of things to verify before moving to the next layer or closing a wall/floor, so that mistakes are caught while they are still visible and fixable.

**Acceptance criteria**
- A task may define completion checks such as level/plumb, opening dimension or photographed evidence.
- Required checks are distinguishable from optional tips.
- Completing a task does not imply a professional inspection where one is actually required.

## BOB-US-037 — Surface common mistakes and escalation points

**Status:** NEW  
**Persona:** Any builder/helper

**Story**  
As a user, I want bob to call out the most important failure modes or "stop and verify" points for a task, so that detailed guidance does not create false confidence around consequential work.

**Acceptance criteria**
- Guidance can identify common mistakes relevant to the task.
- Safety/structural/regulatory uncertainty is clearly separated from ordinary DIY tips.
- Bob can say that a professional/site-specific check is needed rather than fabricating a definitive instruction.

---

# Epic G — Build together, not just plan alone

## BOB-US-038 — Invite people into the project

**Status:** BUILT for confirmed-email invitations; household/friend and name-only volunteer flows prepared in source, with browser/hosted release proof pending

**Persona:** Project owner / organiser

**Story**  
As an organiser, I want to invite family, friends and skilled helpers into the project, so that the people doing the work share one plan and do not rely on separate chats and spreadsheets.

**Acceptance criteria**
- An organiser can invite a person to a project.
- A participant becomes visible in the project crew.
- Ordinary project URLs grant no access. A separately issued volunteer invitation is an explicit, revocable grant for a limited project participant view.
- A volunteer opens that invitation link and enters only their name. They need no email address, password, registration or Auth account. Their name is recorded as a person in this project, not as a shared household/app identity.
- If and only if the project has food planned, the volunteer may optionally enter allergies. Blank means not supplied, not a claim of no allergies. The signed-in project crew can see these notes for food planning; other name-only volunteer sessions cannot.
- The volunteer can see project tasks/instructions, linked task/area images, build days, updates and meal plans. They can manage their own attendance and task participation/progress. They cannot administer project sharing, create household access or edit other participants' profiles.
- The same browser can return to the same participant. Names are not verified and a matching name does not recover an old session. The organiser can revoke a link and all its sessions, or one participant's browser access.
- A project member can choose an existing accepted friend from the shared friend directory and create an in-app invitation to this project.
- The recipient can accept or decline. A pending invitation does not grant project content access, and creating it does not send an email or message.
- Friendship and the inviter's project authority are checked again on acceptance. Once accepted, the Bob project grant lasts until revoked or left in Bob, independently of a later friendship change.
- The friend can collaborate on the project and use its existing physical-context reads/proposals. The invitation does not grant accepted Building editing, household access or access to other projects.
- Existing confirmed-email invitations remain a separate flow. The [data/auth contract](../db/README.md#household-and-friend-sharing) owns effective access and revocation rules.
- [Name-only volunteer access](../db/README.md#name-only-volunteer-access) owns the invitation/session contract, limited actions and allergy boundary (owner clarification, 2026-09-14).

## BOB-US-039 — Record skills and experience per person

**Status:** BUILT  
**Persona:** Project owner / helper

**Story**  
As a participant, I want my skills and experience level represented, so that the organiser and bob can match me to appropriate work.

**Acceptance criteria**
- A person can have multiple skill tags.
- Skill level is represented rather than only a binary "has skill" flag.
- Skills are searchable/visible to the organiser.

## BOB-US-040 — Sign up for a build day

**Status:** BUILT  
**Persona:** Any helper

**Story**  
As a helper, I want to tell the organiser which build day I am coming to, so that people, tasks, tools and food can be planned around the real crew.

**Acceptance criteria**
- A participant can join an open build event.
- The organiser can see who is attending.
- A participant can withdraw if plans change.
- Capacity/full state is handled honestly.

## BOB-US-041 — Match the day's work to the people who are actually coming

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As an organiser, I want bob to suggest a feasible task allocation based on attendee skills, task difficulty, dependencies and readiness, so that the build day uses people's time well without assigning unsafe work blindly.

**Acceptance criteria**
- Suggestions use the actual attendee list for the event.
- Task skill requirement and participant skill level are considered.
- Blocked/not-ready tasks are not proposed as straightforward ready work.
- The organiser makes/approves the actual assignment; bob does not silently assign consequential work.

## BOB-US-042 — Pair less experienced helpers with an appropriate lead

**Status:** NEW  
**Persona:** Project owner / skilled builder / general helper

**Story**  
As an organiser, I want to pair a novice with an experienced lead on suitable work, so that people can contribute and learn without being treated as fully independent skilled labour.

**Acceptance criteria**
- A task can identify a lead/experienced assignee separately or visibly.
- Bob's assignment suggestion can account for supervision rather than only individual skill labels.
- A novice is not upgraded to "expert-capable" simply because the task has a lead.

## BOB-US-043 — Assign people to tasks and areas

**Status:** BUILT / PARTIAL for event-specific scheduling  
**Persona:** Project owner / organiser

**Story**  
As an organiser, I want to assign people to the work they are responsible for, so that everyone knows their role and the organiser can see unowned work.

**Acceptance criteria**
- Tasks can have one or more assignees.
- Areas can show the crew/lead context where supported.
- Unassigned work is visible rather than silently ignored.
- Future event-specific assignment can coexist with general task ownership.

## BOB-US-044 — Give every participant a simple day-of view

**Status:** BUILT / PARTIAL for richer task context  
**Persona:** Skilled builder / general helper / drop-in helper

**Story**  
As a helper arriving on site, I want to immediately see what I am doing today, where it is, who I am working with and whether I can start, so that I do not need a long verbal onboarding.

**Acceptance criteria**
- The day-of surface prioritises today's relevant tasks rather than the full organiser dashboard.
- Each task shows area, status, skill/difficulty and assignees.
- The richer target state can also expose materials/tools/readiness and task guidance without making the day-of view cluttered.

## BOB-US-045 — Let a drop-in helper become useful quickly

**Status:** PARTIAL  
**Persona:** Drop-in helper

**Story**  
As someone helping for only one day, I want a very short path from joining to an appropriate task, so that I can contribute without learning the whole application or project history.

**Acceptance criteria**
- Joining/attendance is low-friction within the project's auth model.
- The helper can see open/assigned work appropriate to them.
- Essential task context is available from the day-of/task surface.

## BOB-US-046 — See build-day readiness before people arrive

**Status:** PARTIAL  
**Persona:** Project owner / organiser

**Story**  
As an organiser, I want bob to flag what will block the next build day — unassigned work, missing materials, missing tools, unfinished dependencies or insufficient skills — so that I can fix problems before the crew arrives.

**Acceptance criteria**
- Readiness is derived from real project/task/event state rather than a decorative percentage alone.
- Each blocker can be drilled into or named.
- A task that is blocked by missing information is distinct from one blocked by missing materials.

## BOB-US-047 — Keep shared announcements out of private chat silos

**Status:** BUILT  
**Persona:** Project owner / organiser / participant

**Story**  
As a project participant, I want important changes and day-of information posted in one project-wide place, so that everyone sees the same current update.

**Acceptance criteria**
- Participants can read project announcements.
- Authorised users can post updates.
- Important updates can be pinned/highlighted.
- Announcements are project-scoped.

## BOB-US-048 — Plan food from real attendance and dietary needs

**Status:** BUILT / PARTIAL for automatic scaling  
**Persona:** Food coordinator

**Story**  
As the food coordinator, I want the meal plan and shopping needs to use the confirmed build-day headcount and dietary/allergy information, so that everyone can be fed safely without a separate spreadsheet.

**Acceptance criteria**
- Confirmed attendees and their dietary context are available to the food workflow.
- Meal plans can be associated with build events.
- Dietary/allergy information remains prominent.
- Food shopping can scale from real attendance when that calculation is implemented, while allowing manual correction.

---

## BOB-US-059 — Share a building and selected projects with my household

**Status:** NEW — specified / implementation in progress

**Persona:** Building member / project owner / household member

**Story**

As a person looking after our home, I want to share a Building with my existing household and choose which projects we collaborate on, so that the family can maintain the same house knowledge and build plans together.

**Acceptance criteria**

- I can select an existing household already available to me in the shared family system used by Maidin and Hearth & Larder; Bob does not create a second family or friendship system.
- Sharing is opt-in. Active members of the chosen household can edit the Building's accepted/current physical model and accept proposals while retaining its evidence and revision history.
- Building sharing management and actual Building deletion remain with direct Building members.
- Each project has an explicit household-sharing choice: no household sharing, share directly with one household, or follow one Building that the project actually targets. Physical association alone never shares a project.
- When sharing a Building, I can explicitly select accessible linked projects to follow it. This adds sharing to the selected projects without overwriting a competing project choice. Future projects require their own explicit choice.
- Household access changes, disabling the share or removing the relevant Building association revoke the affected inherited access. Independent project membership and accepted invitations remain intact.
- The choice and resulting project access survive reload. A denied or stale save remains visible and never claims that sharing succeeded.

The [building contract](building-model.md#111a-household-sharing-extension) owns physical authority; the [data/auth contract](../db/README.md#household-and-friend-sharing) owns precise entitlement sources and revocation.

---

# Epic H — Capture what actually happened and keep the plan alive

## BOB-US-049 — Log progress against the task that was actually done

**Status:** NEW  
**Persona:** Skilled builder / helper / organiser

**Story**  
As a builder, I want to record a short progress/update note on the task I worked on, so that the organiser and next crew know what happened without having to ask me later.

**Acceptance criteria**
- Progress notes are tied to the task and author/time.
- A note does not automatically change task status unless the user explicitly does so.
- Notes remain visible after returning later.

## BOB-US-050 — Capture before, during and after photos

**Status:** NEW  
**Persona:** Any builder/helper

**Story**  
As a participant, I want to attach progress photos to an area/task, so that the project records both the visible result and important intermediate construction stages.

**Acceptance criteria**
- A photo can be tagged before/during/after or equivalent.
- Photos retain task/area and timestamp/actor context.
- Progress photos are distinct from target/reference images.

## BOB-US-051 — Preserve photos of hidden construction

**Status:** NEW  
**Persona:** Project owner / skilled builder

**Story**  
As a project owner, I want photos taken before walls/floors are closed to remain easy to find, so that later we can see where framing, reinforcement, services or other hidden work actually ended up.

**Acceptance criteria**
- A task can identify a photo/checkpoint as important as-built evidence.
- The as-built image remains linked to the final area/task after completion.
- Future users can distinguish planned framing diagrams from photos of what was actually built.

## BOB-US-052 — Update downstream plans when reality changes

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to record changes discovered during construction — such as replacing a damaged beam or changing a dimension — and have bob identify affected tasks/materials/drawings, so that the project does not keep planning from an obsolete assumption.

**Acceptance criteria**
- A real-world change can be recorded with reason and actor/time.
- Bob identifies likely downstream outputs that depend on the changed fact.
- Updates are proposed/confirmed rather than silently overwriting all downstream work.
- Earlier plan/revision history remains available.

The detailed Step / Completion Requirement / Evidence / replanning semantics behind BOB-US-052–053 are owned by [Living project plan](living-project-plan.md). This story document remains the owner of user outcomes rather than duplicating that domain model.

## BOB-US-053 — Continue cleanly on the next build day

**Status:** PARTIAL  
**Persona:** Project owner / organiser / helper

**Story**  
As a participant returning for the next build day, I want bob to show what was completed, what changed, what remains and what is now ready, so that the team can pick up without reconstructing context from memory.

**Acceptance criteria**
- Completed/in-progress/blocked task state is persisted.
- Relevant progress notes/photos can be surfaced from the prior work.
- The next event/readiness view uses the updated project state.

---

# Epic I — Make bob trustworthy enough to build with

## BOB-US-054 — Keep Ask bob scoped to the active project

**Status:** PARTIAL  
**Persona:** Any participant

**Story**  
As a user, I want Ask bob to reason about the project I currently have open, so that an answer or proposed change can never accidentally use another project's measurements, tasks or materials.

**Acceptance criteria**
- AI context is resolved from an explicit authorised active project, not an arbitrary first project row.
- Cross-project data is not included unless the user explicitly invokes an account-level workflow designed for it.
- Project switching changes subsequent AI context predictably.

## BOB-US-055 — Distinguish facts, derived values, assessments and unknowns

**Status:** NEW  
**Persona:** Any participant

**Story**  
As a user, I want bob to show whether a statement is a measured/provided fact, a calculation, an AI/human assessment or still unknown, so that I can judge what is safe to rely on.

**Acceptance criteria**
- The product can represent at least FACT / DERIVED / ASSESSMENT / UNKNOWN semantics for consequential project information.
- A derived value can point to its source inputs.
- An assessment does not silently overwrite a verified fact.
- Unknown is a valid domain state, not treated as an application error.

## BOB-US-056 — Preserve provenance for AI-created project information

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want to know when a drawing note, quantity, proposed task or assessment came from bob, so that AI-produced information is not indistinguishable from measured or human-verified project truth.

**Acceptance criteria**
- Consequential AI-created/derived records preserve actor/source/run provenance where relevant.
- Human confirmation/verification can be recorded separately from AI origin.
- Revisions do not destroy the origin of prior outputs.

## BOB-US-057 — Delegate ordinary work and retain control over consequential changes

**Status:** NEW  
**Persona:** Project owner / organiser

**Story**  
As a project owner, I want Bob to carry out ordinary reversible work within my request and explain consequential changes that need my decision, so that the project advances without repeated permission questions and I retain control over its direction.

**Acceptance criteria**
- Material changes to selected solution/geometry/assignments are reviewable before canonical replacement where consequence warrants it.
- The user can accept, reject or edit the proposal.
- Rejection does not destroy the current project state.
- Saving a working specification, updating delegated task instructions or preparing a proposal does not require a new confirmation for each tool call. Follow-up messages continue the understood task until changed or cancelled.
- Existing explicit approval of the canonical project plan is a distinct decision, not a general gate on all preparatory work. Necessary physical checks remain open while independent work continues.

The explicit AI plan-change proposal/approval model behind BOB-US-057 is also specified in [Living project plan](living-project-plan.md). Existing write authority remains owned by the current data/auth and Ask Bob contracts until that plan model is implemented.

## BOB-US-058 — Escalate site-specific safety or professional judgement

**Status:** NEW  
**Persona:** Any participant

**Story**  
As a user, I want bob to identify when guidance depends on site-specific structural, electrical, plumbing, fire, permit or other professional/regulatory judgement, so that a detailed tutorial is not mistaken for engineering or local approval.

**Acceptance criteria**
- Bob may provide general educational context while explicitly identifying the unresolved professional/site-specific dependency.
- The system does not invent a definitive structural/load/code answer when required inputs or authority are absent.
- The task/project can retain the unresolved check as a blocker or required verification.

---

# Cross-epic end-to-end stories

These are the product-level journeys that tie the individual stories together. They are useful candidates for future success-path and E2E contracts.

## BOB-JOURNEY-001 — Photo to executable project

As a project owner, I can show bob photos of an existing space and explain the desired change; bob helps me collect the missing measurements and existing-condition facts; I compare and select a solution; bob produces clearly qualified drawings, material requirements and an ordered task plan; and all of that remains connected to one project I can return to later.

## BOB-JOURNEY-002 — Plan to build day

As an organiser, I can invite people, know who is coming, see their skills, identify which tasks are actually ready, make/approve assignments, confirm materials/tools/food, and give every participant a simple day-of view with the right task context and images.

## BOB-JOURNEY-003 — Task to "How do I?"

As a helper, I can open my assigned task, understand the goal/materials/tools/time/difficulty, inspect the relevant drawing or intermediate-construction image, ask for detailed "How do I?" guidance when needed, complete the listed control points, and record what I actually did.

## BOB-JOURNEY-004 — Reality changes the plan

As a project owner, I can record that the build differs from the plan; bob preserves the prior decision, identifies affected drawings/materials/tasks, proposes updates, and the next build day uses the revised project truth instead of stale assumptions.

---

# Explicit product implications discovered by these stories

These are not yet implementation decisions, but the user stories make the following domain needs hard to avoid:

1. **Media is project truth, not decoration.** bob needs real stored images/files with type, provenance and project/area/task relationships.
2. **Measurements need truth state and provenance.** Estimated, provided and verified dimensions cannot be one anonymous numeric field.
3. **A selected solution needs revision identity.** Drawings, material calculations and work plans must be able to say which version they came from.
4. **Existing/reused stock is different from required material.** "Have", "need", "ordered", "delivered" and "used" should not be collapsed into one ambiguous quantity.
5. **Calculated quantities need explainable inputs.** Nails, paint and timber counts are only trustworthy if the user can inspect the calculation basis and allowances.
6. **Tasks become the bridge between planning and collaboration.** A task needs enough structure to connect design, measurements, materials, tools, guidance, people, event readiness and progress.
7. **AI authority must be bounded.** bob can analyse and propose, but consequential canonical changes need explicit human/project authority and visible provenance.
8. **The collaborative core remains first-class.** The new planning intelligence should feed People, Events, Today, Shopping, Food and Announcements rather than becoming a separate single-user AI island.

# Not decided by this document

This story contract deliberately does **not** decide:

- which stories are the next V0/vertical slice;
- exact database tables or APIs;
- which image/drawing models/providers are used;
- exact structural calculation methods;
- local building-code/permit integration;
- whether detailed "How do I?" guidance ships in the first implementation slice;
- final UI/routes for new concepts.

Those decisions should be made after this user-story landscape is accepted, using the existing project-start method: function inventory → difficulty/scope → first truthful vertical slice → data/authority and interaction contracts.
