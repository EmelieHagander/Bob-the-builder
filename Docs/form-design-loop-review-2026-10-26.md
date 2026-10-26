# FORM 1.0 × Bob — tidig designloop från förslag till korrekt ritning

> **Status 2026-10-26:** Daterad analys, låst FORM-referens och **föreslaget implementationsunderlag**. Ingen ny runtime, migration, CAD-funktion eller UI har byggts eller verifierats av detta dokument.
>
> **Underlag:** Genomgång av Bob main vid commit [1f1b4b9b](https://github.com/EmelieHagander/Bob-the-builder/commit/1f1b4b9b419d6818a970c1ea8c75233224d6b1e3) den 26 oktober 2026, kod och nuvarande domänkontrakt samt ett praktiskt designförsök med en smådjurslada. Slutsatser om avsaknad av generell förmåga gäller granskad kod, inte en fullständig live-acceptans.
>
> **Dokumentroll:** FORM beskriver **metoden** och detta dokument visar upptäckta gap, tänkbar integration och acceptans. Normativ produkt-/domänsanning stannar hos [user-stories](user-stories.md), [project-phases](project-phases.md), [solutions](solutions.md), [building-model](building-model.md), [artifacts](artifacts.md), [cad-adapter](cad-adapter.md), [media-and-steps](media-and-steps.md), [bob-delivery-flow](bob-delivery-flow.md) och deras implementerade kod. Nya beslut om data- och verktygskontrakt ska skrivas hos respektive ägare och länkas här, inte tvärtom.

> **Implementation follow-up:** the selected seam and current data contract now live in [Solutions](solutions.md#early-concept-geometry-form--source-implementation-2026-10-26). This dated analysis remains the proposal baseline; [State](bob-delivery-flow.md#state) distinguishes source implementation from remaining release and real-model acceptance.

## Varför detta finns

I ett verkligt designförsök kunde AI:n beskriva användarens idé om en faluröd djurlada men fortsatte generera felaktiga genomskärningar: tre rum placerades över bredden i stället för efter längden, djurrum öppnades mot loft trots krav på plana slutna tak, stegar lutades ut i rummet trots krav på lodrät väggmontering, och inre höjder passade inte självklart i totalhöjden. Skriftliga rättelser räckte inte för att säkra bildgeometrin. Enkla 2D-principskisser blev det effektiva gemensamma språket.

**Problemformulering:** Bob kan gå från vald Solution via detaljerad, versionslåst konstruktion till CAD och oberoende granskning, men har ännu inte ett verifierat generellt, snabbt och korrigerbart 2D-steg för att få geometrin överenskommen **före** den dyra konstruktions-/renderingskedjan. Detta är ett separat problem från avbrott i CAD-save, källa/RLS, läsprestanda och jobbrecovery, som fortsatt ägs av befintliga kontrakt.

**Hypotes, inte uppmätt effekt:** Tidiga deterministiska 2D-loopar kan minska sena geometriomtag och ge färre fel i sparade ritningar. Verifiera med upprepade riktiga ägar-/modellfall och jämför både kvalitet och kostnad.

## Låst referens: FORM version 1.0

FORM betyder **Från Önskemål till Realiserbar Modell**. Referensprocessen för fysiska objekt, från låda till hus:

1. **Förstå:** syfte, användning, plats och risk.
2. **Krav:** separera uttryckliga krav, val, önskemål, egna förslag, antaganden och okänt; behåll ursprung.
3. **Enkel 2D-mockup:** snabb plan, snitt, sidovy eller relationsskiss med rätt axlar och mått där de är kända.
4. **Gemensam revision:** användaren korrigerar skissen tills den uttrycker avsedd geometri; bekräfta betydelsefulla val, utan obligatoriskt klartecken för varje reversibel ändring.
5. **Geometrisk modell och kontroll:** en konsekvent källa till alla vyer; kontrollera relationer, storlekar, motstridiga krav och stödgränser.
6. **Visualisering:** illustration/fotorealistisk bild från den fastställda modellen, med tydlig skillnad mellan estetisk representation och mätbar geometri.
7. **Granskning:** jämför varje vy/bild mot aktuella krav, källor, perspektiv, axlar, delar och antal; redovisa avvikelser.
8. **Versionerad revision och leverans:** riktade ändringar, beroendespårning och återläsbar version, utan att radera äldre beslut.

**Skalbarhet:** En enkel låda kan passera stegen på ett ögonblick; en större byggnad kan behöva flera iterativa vyer och tekniska kontroller. Skisser är ett medel för förståelse, inte ett universellt obligatoriskt tillstånd. Önskemål om endast inspiration får inte felaktigt eskaleras till komplett konstruktion. FORM är **inte** en ny ProjectPhase-hierarki, ett nytt godkännande för varje verktyg eller en säkerhetscertifiering.

**Grundregel:** Diskutera och korrigera billigt i 2D innan en geometriskt styrd detaljerad ritningsbeställning låses. Vid fortsatt ändring ska modellen och alla påverkade vyer revideras ihop; gör inte bara en ny bildprompt.

## Hur metoden passar Bobs nuvarande livscykel

- **Explore:** billig, reversibel utforskning; inget blir sparad verklighet bara för att det skissats.
- **Concept:** förstå befintligt och önskat tillstånd, krav, storlek, källa och större osäkerheter.
- **Design:** skapa lätta modellbundna 2D-alternativ, korrigera och välja en Solution-revision; här passar FORM:s huvudsakliga samarbetsloop.
- **Planning:** återanvänd exakt vald geometri i konstruktionskontroll, CAD, material, Steps och Tasks. En låst skiss är inte automatisk konstruktion.
- **Build/Complete:** byggsteg, kontrollpunkter, verkliga utfall och as-built; FORM får användas för en lokal omdesign utan att hela projektet backas.

Projekt, Area och Step kan vara i olika faser enligt [project-phases](project-phases.md). FORM ska gå att återanvända inom en pågående ändring; den ska inte tvinga hela Projektet tillbaka till Design.

## Belagt nuläge och avgränsade gap

| Förmåga | Nuläge vid granskat main | Gap/fortsatt acceptans |
| --- | --- | --- |
| Förslag, alternativ, designavsikt | Solution-revisioner och design_intent (features, referenser, choices, alignment) finns; target väljs explicit | Hur tidig skiss och korrigerad geometri hänger ihop med *ännu icke vald* Solution och därefter exakt target måste preciseras |
| Bildmockup från foto | generate_project_image kan använda autentiserade bildreferenser; illustrationsstatus bevaras | Bildkvalitet och efterlevnad mot faktiska ägarreferenser behöver verkligt prov; bildpixlar är inte geometriauktoritet |
| Deterministiska 2D-vyer | Specifika SVG-studier finns: förvaringslåda, rumpar och koordinatplan; CadShellView kan flytta redan sparade CAD-delar | Ingen observerad generell tidig skiss-/ändringsloop för godtyckliga objekt; efterhandsplacering av CAD-delar löser inte alltid fördesign |
| Konstruktionsmodell | Sparade konstruktioner med instanser, geometri, material, fogar, parametrar och riktade ändringar | Tyngre än en principmockup; felaktig topologi sent ger kostsam korrigering. Befintliga identiteter och källspärrar ska bevaras |
| CAD och granskning | Den valda konstruktionen kontrolleras och renderas; CAD-review jämför med handoff och referenser | Medlems-/modellacceptans av rätt mockup → ritning → save/readback är kvar. Jobb- och sparproblem hanteras separat i State/issue #308 |
| Riktiga snitt | CAD-vyer: front/back/left/right/top/bottom samt isometrier. Manual Artifact kan klassas som section | **Generisk kapning med angivet snittplan** saknas i granskad CAD-vyuppsättning; projektion av ytterkontur är inte en faktisk längdsektion |

Spårbar kod: [project-design-intent.ts](../supabase/functions/_shared/project-design-intent.ts), [project-image-tools.ts](../supabase/functions/_shared/project-image-tools.ts), [construction-draft.ts](../supabase/functions/_shared/construction-draft.ts), [construction-checks.ts](../supabase/functions/_shared/construction-checks.ts), [cad-assistant.ts](../supabase/functions/_shared/cad-assistant.ts), [cad-adapter.ts](../supabase/functions/_shared/cad-adapter.ts), [cad-review.ts](../supabase/functions/_shared/cad-review.ts), [CadShellView.tsx](../src/components/CadShellView.tsx), [buildingPlanSvg.ts](../src/lib/buildingPlanSvg.ts), [roomLayout.ts](../src/lib/roomLayout.ts).

**Observationsgräns:** Detta bygger på kod och releasehistorik, inte på nya körningar av Bob med en riktig ägare. I synnerhet är den öppna [CAD-arkitekturgranskningen #308](https://github.com/EmelieHagander/Bob-the-builder/issues/308) historiskt daterad och behöver prövas mot senare releaser innan nya runtimeåtgärder bestäms. [PR #339](https://github.com/EmelieHagander/Bob-the-builder/pull/339) och [#340](https://github.com/EmelieHagander/Bob-the-builder/pull/340) införde 26 oktober läsning av sparade projektfakta vid turstart och kompakt konstruktionstabell; tidigare medelvärden för läsningar/tidsåtgång är baslinje, inte resultat efter ändringen.

## Föreslagen FORM-designloop i Bob

**A. Förståelse:** Bob identifierar målobjekt, delarna, bindande krav, källa, styrande riktningar och okänt. En tidig snabb skiss får bygga på uttryckliga konceptantaganden, men antaganden får inte förvandlas till mätfakta.

**B. Geometrisk dialog:** Bob producerar en enkel deterministisk 2D-plan/sidovy/relevant sektion från en och samma strukturerade *kandidat*. Varje del har stabil identitet; den har dimension/placering, koordinatram, relationer och koppling till relevant krav. Exempel: stege monterad lodrätt på skiljevägg, loftgolv över djurrum, fönster på rätt fasad. Användarens ”flytta stegen mot väggen” blir en riktad ändring, inte en ny fri bildtolkning.

**C. Kvalitetsgrind efter relevant ändring:** kontrollera att samma modell genererar alla efterfrågade vyer, att axlar/snittplan är explicit benämnda, att krav uppfylls och att olösta geometri- eller höjdkonflikter står kvar. En korrigerad vy ska inte oavsiktligt ändra andra delar.

**D. Fördjupning:** När ett valt designsnitt är tillräckligt förstått sparas/anknyts exakt version enligt befintliga Solution-/target-regler. Bob fortsätter med konstruktion bara där det behövs, med material/fogar/kontroll/källkoppling enligt existerande K1–K3. CAD och oberoende granskning måste få exakt designavsikt, källversion och relevant geometri; inga bildpixlar får ensamma utgöra mått.

**E. Visuell jämförelse:** efter CAD/render granskas kandidatens samtliga relevanta vyer mot originalkrav, skissversion och källbilder. Avvikelse redovisas med komponent/krav/vy. Korrekt granskning utan verkligt spar-, Step-länk- och återläsningskvitto är fortfarande en ofullständig leverans.

### Data- och ägargränser – beslut inför implementation

- **Solution** fortsätter äga alternativ, designavsikt, betydelsefulla beslut och vald target. En tidig skiss kan behöva existera innan target väljs; lösningens befintliga revisionsidentitet ska undersökas först.
- **Building/Space/Element och Facts** fortsätter äga observerad fysisk verklighet och källors kvalitet. Konceptgeometri uppdaterar aldrig as-is automatiskt. Ett fristående byggobjekt kräver inte en påhittad Building.
- **Artifact och Construction** fortsätter äga byggritning och kontrollerad konstruktionsrevision. Ett nytt skissförslag blir inte en byggklar Artifact bara av att ha mått.
- **Media** fortsätter äga foton och fria illustrationer. SVG-bilder bör vara deterministiska derivat av den versionerade modellen när exakthet krävs.
- **AI och UI** ska använda befintlig behörighet, källaktualitet, ändringskvitton, resumerbarhet och mobil vy. Undvik en andra state machine och hårdkodade objektmallar.
- **Öppet beslut:** precis representation, lagringsyta och övergång mellan *ovald kandidat* → *vald designversion* → *kontrollerad konstruktion* måste designas i rätt domänägare före migration. Detta dokument låser inte JSON-schema, tabell, verktygsnamn eller API.

## Snitt och vyer – särskild lucka

Håll isär:
- **Plan/projektion:** vad som syns från en given riktning.
- **Längdsektion:** snitt genom objektet längs en explicit axel och på ett angivet tvärläge.
- **Tvärsektion:** snitt genom den andra axeln.
- **Friillustration:** estetisk bild utan geometriintyg.

I ladfallet: X = längd 0–6 m, Y = bredd 0–3 m, Z = höjd. För en principskiss av längdsnittet ska planet vara XZ vid Y ≈ 1,5 m (eller annat uttryckligt läge), med tre rum efter varandra, två separata slutna loft och öppet mittparti. Taknocken löper i X-led; ett triangelformat *gavelsnitt* får inte etiketteras som längdsektion. Valet av snittläge styr exakt vilka stegar och öppningar som skärs. Vid 3,5 m totalhöjd ska konflikten mellan önskad 2,0 m fri höjd, 1,5 m loftutrymme, bjälklag, tak och grund upptäckas, inte döljas.

**Implementation:** ett generellt snittplanskontrakt och deterministisk geometrigenerering är ett **separat möjligt CAD-/vy-tillägg**, inte något som finns verifierat i dagens projektioner. Det tidiga 2D-konceptet kan ändå representera principsnitt korrekt utan att påstå att det är en byggteknisk CAD-kapning.

## Rekommenderad första work-session

1. **Kartlägg minsta seam (utan implementation):** vilka käll- och revisons-ID:n från Solution/target/Building/Artifact kan ge en reviderbar skisskandidat före vald target? Välj en enda befintlig domänägare; skriv beslut där. Undersök även CAD:s aktuella riktningar, previews, skiss-/konstruktionsverktyg och revisionsbeteende.
2. **Bygg en vertikal liten generaliserad loop:** ett begränsat gemensamt geometrirecept för enkla komponenter/ytor/öppningar + namngiven koordinatram, snabb generering av minst plan och vald profil/principsnitt från *samma* data, och idempotent, avgränsad revision av utvalda komponenter. Håll stödomfattningen tydlig utan att döpa objekt efter möbel-/byggnadstyp.
3. **Knyt till befintlig designavsikt:** krävd feature/choice ↔ namngiven del/relaterad vy, sparad revision, status och källhänvisningar; välj target enligt befintlig beslutsgräns, inte vid varje liten ändring.
4. **Kontrollera överlämningen:** granska att en vald skissrevision ger samma relations- och måttkrav till den befintliga konstruktionen, att konstruktion kan markera unsupported/missing, och att CAD-kandidatens aktuella vyer följer dess källa. Gör inte generisk snittmotor till första slicens obligatoriska beroende om det hindrar en tidig fungerande 2D-loop.
5. **Prova ändringar, omladdning och utfall:** målprojekt och referensbilder återfinns; korrekta reviderade vyer kan läsas efter reset, och berörd senare ritning blir synligt inaktuell. Verklig CAD-/modellacceptans är separat från deterministiska tester.

### Minsta acceptansmatris – tre olika objekt, samma förmåga

| Test | Användning och korrigering | Måste vara observerbart |
| --- | --- | --- |
| **Låda** | Enkel plan/sidovy, ändra höjd eller väggtjocklek | Samma del-ID, uppdaterade beroende mått, ingen påverkan på orelaterade delar; koncept vs mätning framgår |
| **Våningssäng** | Skiss med stege på rätt sida, lådor och öppning; ”flytta stegen utan att ändra lådorna” | Sparade funktioner från originalreferensen bevaras, spegling upptäcks och rättad version återöppnas; senare CAD-review jämför exakt referens/krav |
| **Lada** | Tre rum i längdriktningen, platt tak över två djurrum, två loft, helt väggmonterade stegar; ”snitta på längden, inte tvären” | Benämnt XZ-plan, rätt ordning, konsekventa fönster/öppningar, samma mått i olika vyer, omöjlig höjdsumma flaggas |

Negativa fall: okänd längd ska inte bli ett uppmätt värde; fel axel och saknad väsentlig feature ska ge avvikelse; ändrad källrevision ska inte användas tyst; en ny komponents ID får inte ersätta ett annat; konkurrerande uppdatering får inte skriva över den senaste versionen; ett lyckat modellord får inte ersätta spar- och återläsningskvitto; saknat stöd ska förklaras utan fabricerad geometri. Återkommande promptmanus för varje objekt är inte acceptabelt.

**Mät:** riktiga användarkorrigeringar fram till accepterad modell, andel felaktiga vyer, CAD-omtag per accepterad ritning, falska godkännanden, antal modell-/verktygsanrop, kostnad och återöppning av rätt version. Baslinje före/efter ändring ska baseras på jämförbara fall, inte historiska genomsnitt som om de gällde efter nya releaser.

## Avgränsning och säkerhet

- Denna PR **endast dokumentation**; ingen databasändring, runtime, bildgenerator, web UI, betald AI, driftsättning eller genomförd acceptans.
- Bevara Bobs nuvarande authority, fastställd/uppskattad/okänd-semantik, per-projektisolering, revision/fingerprint, K2-kontroll, oberoende CAD-review och mottagarkvitton.
- Ingen regel om att varje användare måste godkänna alla skissrevisioner. Bob får göra motiverade reversibla val inom mandat; betydelsefull riktning väljs av användaren eller av Bob där mandat faktiskt finns.
- Konceptuell skiss, kontrollerad ritgeometri och fysisk/ingenjörsmässig säkerhet är tre separata nivåer. Barnmöbler och bärande byggnader kräver relevanta fackmässiga och säkerhetsmässiga kontroller.
- Full suite, CI, live CAD/AI och workflow/deploy är enligt [CLAUDE.md](../CLAUDE.md) och [verify](../.claude/skills/verify/SKILL.md) ägarstyrda. En merged dokumentations-PR är **inte** en runtime-release.

## Slutsats

Förbättra inte Bob enbart genom att göra fler eller vackrare ritningar. **Förbättra först hur Bob och användaren fastställer vad som ska ritas**: billiga, konsekventa 2D-vyer, tydliga geometri- och kravid:n, riktade korrigeringar och en stabil vald version till befintlig konstruktions- och CAD-kedja. Behåll Bob som ansvarig för hela byggets livscykel; FORM är hans lätta och verifierbara tidiga designsamarbete.

**Nästa handling:** använd detta som underlag för en avgränsad implementations-worksession. Läs domänägarna och aktuell kod innan schema/API väljs. Uppdatera respektive kanoniskt kontrakt och State vid faktiskt beslut eller implementation; rapportera varje test som lokalt, syntetiskt eller ägar-/liveverifierat.
