# Bob: generell granskning av verktyg och genomförande

**Datum:** 2026-09-25, efter PR #146. **Baslinje:** main `e42bf8ea8e8035b4319bb6e1448036dec59304ca`, Ask Bob v44 och bob-worker v12. Samtliga 50 respektive 48 återlästa runtime-filer matchade baslinjen. Modellinställningar, aktuell verktygskatalog och avgränsade körspår lästes i drift. Detta är en daterad granskning, inte ett nytt runtime-kontrakt eller ett påstående att fynden är rättade.

Granskningen följer de fem användarfallen i [user-stories.md](user-stories.md). Kontraktens ägare förblir [verktyg](ask-bob-tools.md), [genomförande och samtal](ask-bob-conversations.md), [skrivningar](ask-bob-writes.md), [plan](living-project-plan.md) och [CAD](cad-adapter.md). Den [tidigare auditen](bob-context-audit-2026-09-24.md) beskriver ett äldre läge.

## Bedömning av de tre hypoteserna

| Hypotes | Vad beläggen visar | Bedömning |
|---|---|---|
| Bob är inte smart nog | Huvud-Bob och CAD kör faktiskt `gpt-5.4`, reasoning `high`. Ingen extra databasstyrd personaprompt ersätter kodens prompt. Dagens användningsposter bekräftar dessa modellnamn. | Det finns inget kontrollerat belägg för att ett modellbyte löser huvudproblemen. Modellens beteende behöver utvärderas, men flera hinder ligger i applikationen. |
| Bob har inte verktygen | 45 aktiva katalogverktyg och ett pensionerat finns. De flesta centrala handlingarna har registrerade implementationer, men synlighet, budget och tillstånd varierar. Några UI-handlingar saknar Bob-verktyg. | Delvis sant. Implementerat, upptäckbart, erbjudet i nästa anrop och tillåtet att utföra är olika saker. |
| Bob vet inte vad verktygen gör | Erbjudna verktyg får numera sina guider. Däremot kan sökning peka mot en uttryckligen olämplig förmåga, och flera komplicerade indata beskrivs som fri JSON/prosa med otillräckliga felbesked. | Delvis sant. Problemet är inte generellt borttappad dokumentation; förmågor, förutsättningar och återhämtning förmedlas ojämnt. |

**Huvudproblemet är genomförandekedjan:** Bob kan välja bort själva leveransen, förbruka nödvändiga läsningar och avsluta med text som systemet godtar. Fler verktyg eller fler uppmaningar att vara självgående räcker inte som lösning.

## Vad som faktiskt körs

| Roll | Modell / reasoning | Faktiskt outputtak vid avläst konfiguration |
|---|---|---:|
| Huvud-Bob | GPT-5.4 / high | 16 000 |
| Ny ritningsklassificering | Samma inställningsrad som huvud-Bob | 16 000 |
| CAD-designer | GPT-5.4 / high | 16 000 |
| Plansammanställare | GPT-5.4-mini / low | 24 000 |
| Planens rådgivande granskare | GPT-5.4-nano / low | 4 000 |
| Samtalsminne | GPT-5.4-mini / low | 3 000 |

Taken ovan kommer från adapterns `min(max(databasvärde, anropsvärde), modellgräns)`. De är inte förbrukning. Huvudflödets begärda 8 000 och klassificeringens 4 000 sänker alltså inte databasens 16 000. Plansammanställarens begärda 24 000 höjer databasens 8 000. Bildgenerering använder separat `gpt-image-2`.

En syntetisk namngiven skrivar-session med full registrering och avläst produktionskatalog ger följande **före ritningsklassificering och dynamiska följdverktyg**. Antalen inkluderar två verktyg för listning/laddning. Byte avser applikationens serialiserade schemasamling, inte token eller hela provider-anropet.

| Projektfas | Erbjudna verktyg | Schemabyte | CAD direkt erbjudet |
|---|---:|---:|---|
| Ingen / Complete | 17 | 22 166 | Nej |
| Concept | 22 | 48 026 | Nej |
| Design | 24 | 43 974 | Ja |
| Planning / Build | 26 | 42 202 | Nej |

PR #146 erbjuder även CAD vid identifierat ritningsuppdrag oavsett fas. Det är en riktig förbättring, men ingen generell styrning av verktygen efter uppdrag. Systemtexten i Planning är dessutom 7 310 tecken. Storleken är uppmätt; att just storleken försämrar modellens beslut är **inte** isolerat visat.

## Fynd

### A1 — P1: Generell kontroll av leverans saknas

**Reproducerat med riktiga runtime-funktioner och styrda modellsvar.** För uppdrag att skapa en uppgift, ändra planen respektive spara en materiallista accepterar nuvarande loop svaret ”Jag kan göra det i nästa svar” med `ok=true`, `partial=false` och noll skrivningar. Det gäller när assistenten aldrig försökt göra arbetet. Den befintliga extra granskningen aktiveras först efter vissa assistentförsök eller avvisade skrivningar.

PR #146 lägger till en leveranskontroll enbart för ritningar. Även den kontrollerar sparad ritningspost, inte att rätt konstruktion, revision, vyer eller steglänkar motsvarar hela uppdraget. `drawingSaved` tar inte emot någon uppdragsbeskrivning att jämföra med.

**Verkligt beteendebelägg före #146:** de två senaste privata arbetsvändorna använde läs- och skrivverktyg, sparade delresultat och avslutade utan CAD-anrop. Den senare hade cirka åtta minuter kvar vid sista modellrundan. Den föregående hade också gott om tid. Budget för modellrundor eller total tid förklarar alltså inte ensamt dessa avslut. Vid denna granskning fanns ingen ny privat körning efter #146; dess beteende i just samtalet är ännu inte prövat.

**Åtgärd:** håll ett kompakt, beständigt uppdragstillstånd kopplat till befintlig tur/samtal: önskat resultat, verifierade delresultat, nästa handling och faktisk blockerare. Avslut ska stämmas av mot efterfrågad ändring och kvitton, exempelvis godkänd planrevision eller materialposter från rätt ritning. Detta är genomförandestatus, inte en ny parallell projektplan. Bevara skillnaden mellan levererat, partiellt, tekniskt fel och nödvändig observation på plats.

Källor: `project-answer.ts`, `project-delivery.ts`, `project-turn.ts`; avgränsade produktionsspår 2026-09-25 15:12:30–15:20:00 UTC.

### A2 — P1: Verktygssökningen kan rekommendera fel förmåga

**Reproducerat med den avlästa katalogen.** Sökning är bokstavlig AND-matchning i engelska namn och kortbeskrivningar; guiderna ingår inte.

| Fråga till `list_tools` | Resultat |
|---|---|
| `ritning` | Inga träffar |
| `ändra planen` | Inga träffar |
| `draw bed` | Endast `save_project_drawing` |
| `CAD` | Bland annat rätt generell CAD-assistent |

Den tredje träffen kommer från lådverktygets negativa formulering ”cannot draw a bed”. Den generella CAD-assistenten saknar ordet bed och faller bort. Modellen kan rädda situationen genom annan sökning eller bläddring, men katalogen arbetar här mot uppdraget. Vi har inte sparade sökargument som visar att just denna fras användes i incidenten.

**Åtgärd:** sök på positiva förmågor med svenska/engelska alias och stöd för synonymer; separera begränsningar från sökbara triggers. Behåll bläddring och exakt laddning. Erbjud relevanta förmågor och deras nödvändiga följdverktyg utifrån uppdrag och tillstånd, med samma behörighetskontroller. Undvik objektspecifika ritgeneratorer.

Källor: `project-tools/session.ts`, produktionskatalogen och den daterade metadatafixturen.

### A3 — P1: Små delbudgetar bryter vanliga arbetskedjor

**Kodbelagt och reproducerat; ett delproblem syns i verklig körning.**

- Huvud-Bob har tolv projektläsningar. Briefingen tar en. I den senaste incidenten gick sex plus fem läsningar åt på två modellrundor. När en bild sedan öppnades fanns ingen budget för bildomslutningens två nya läsningar av projekt/mått. Provet visar `budget_exhausted` för båda, samtidigt som modellen fortfarande anropas med bilden. Tidigare lästa fakta finns kvar i kontexten, men den utlovade färska förankringen saknas.
- Åtta skrivförsök gäller för hela turen, inklusive förberedelser och ogiltiga försök. Provet sparar åtta enkla uppgifter; den nionde stoppas. Ett materialbehov per CAD-definition innebär att större listor inte kan bli färdiga i en tur med dagens enpostverktyg. Bakgrundsfortsättning ökar inte denna gräns.
- CAD förlorar forskningsverktygen efter tre rundor med andra verktyg än rendering. I provet återstår 36 av 40 projektläsningar när nästa nödvändiga läsning inte längre erbjuds. Detta kan även hindra undersökning av ett problem upptäckt efter rendering.

**Åtgärd:** ge modellen synlig budget och återstående genomförande; reservera nödvändiga verifieringsläsningar, undvik onödiga upprepningar och tillåt avgränsad research efter geometrifel. För större uppdrag behövs säkra batchar eller checkpointade deluppdrag med kvitton. Att enbart höja alla gränser löser varken felprioritering eller säkert återupptagande.

Källor: `ask-openai.ts`, `project-lookup.ts`, `project-grounding.ts`, `project-write.ts`, `cad-assistant.ts`.

### A4 — P1: CAD kan inte visuellt kontrollera sin egen leverans

**Reproducerat vid rendering genom syntetisk transport.** Designern får mått, delar, geometrikontroller och vyernas namn. Varken SVG-innehåll eller en rasterbild av den genererade ritningen skickas tillbaka till modellen. Valda referensbilder kan däremot levereras som pixlar. Huvud-Bob får en kort sammanfattning, titel, antal delar och antaganden från CAD.

Numerisk kontroll fungerar och ska behållas. Den är inte en visuell jämförelse mellan beställning, referens och ritning. En sparad korrekt fil kan fortfarande visa fel sida, fel utsnitt eller ett svårtolkat underlag.

**Åtgärd:** ge designern kontrollerade förhandsbilder från exakt samma geometri/revision, tillsammans med koordinatriktningar och relevanta referenser. Kontrollera uttryckliga placeringskrav numeriskt där det går och granska vyernas läsbarhet visuellt. Renderade vyer ska komma från CAD-motorn, inte generativ bildskapande.

Källor: `cad-assistant.ts`, `cad-adapter.ts`, `project-context/dispatcher.ts`.

### A5 — P1: Komplicerade kontrakt ger för svag hjälp vid fel

**Reproducerat.** En CAD-del där `y_mm` saknas ger bara `status=unavailable`, `reason=invalid_geometry`. Modellen får inte fältväg, förväntat värde eller skillnaden mellan felaktig indata och otillgänglig tjänst. Försöket förbrukar samtidigt en av fyra renderingar. Giltig kontrollgeometri når transporten och blir kandidat.

CAD-recept, planändringars `values` och flera operativa verktygs `data` har öppna objektscheman. Delar av deras verkliga kontrakt ligger i långa prosabeskrivningar och separat valideringskod. Task- och citatdiagnostiken från #145 är förbättrad, men många andra domänfel ger fortfarande `domain_fields` utan utpekade fält.

**Åtgärd:** använd gemensamma typade kontrakt där strukturen är känd och återför korta strukturerade valideringsfel med fältväg. Skilj `invalid_input` från tjänstefel och revisionskonflikt. Modellen ska kunna korrigera samma försök med bevarad avsikt; kontrollerna ska inte göras svagare.

Källor: `cad-adapter.ts`, `cad-assistant.ts`, `plan-edit.ts`, `project-operations.ts`, `project-write.ts`.

### A6 — P1: Verifieringen motsvarar inte Bobs arbetsmiljö och uppdrag

**Ny verifierad skillnad:** offline-seeden innehåller 35 aktiva verktyg; produktion har 45. Bland annat planens sammanställning, sparande/beslut och materialkatalogverktyg saknas i seeden. Den används inte som fallback i drift, vilket är korrekt, men flera runtime-tester använder den eller uttryckliga specialuppsättningar. I samma syntetiska Planning-session ger seeden 18 verktyg/24 136 schemabyte, mot driftens 26/42 202. Det ursprungliga katalogtestet jämför endast de 15 bootstrap-raderna.

De tidigare teoretiska projektscenarierna kör riktig modell men begär uttryckligen inga ändringar och anger verktygsnamn i frågan. De visar läsning och resonemang, inte att Bob själv hittar, väljer, utför och sparar. #146:s test svarar själv på intent-klassificeringen och väljer verktyg åt modellen. Det är värdefull mekanikverifiering, men ingen mätning av autonomi. 552 gröna tester kan därför samexistera med den observerade användarupplevelsen.

**Åtgärd:** generera en representativ testpolicy från hela migreringskedjan och jämför den med operatörsändringar separat. Lägg till verkliga modellprov med vanlig svenska utan API-namn och kontrollera sparat slutresultat, återbesök, rätt roll och en viktig felväg. Jämför modellalternativ först när samma uppgifter och verktygsyta kan utvärderas på det sättet.

Källor: `catalog-seed.json`, `tests/tool-catalog-db.test.ts`, `tests/support/tool-loadout.ts`, `tests/bob-drawing-delivery.test.ts`, `scripts/check-live-project-scenarios.mjs`.

### A7 — P2: Den senaste ritningsrättningen kopplar alla privata frågor till ett extra modellsteg

Varje tur med writer och CAD-assistent klassificeras innan huvudsvaret, även en informationsfråga eller ett rent uppgiftsärende. I produktion skapas CAD-assistentobjektet även om själva CAD-tjänsten är otillgänglig. Klassificeringen kör samma standard/high-inställning och har effektivt 16 000 token i tak, trots anropets 4 000.

**Reproducerat:** ett fel i klassificeringen av ett uppgiftsärende avslutar hela turen med `ai_unavailable` innan ordinarie Bob får arbeta. Ingen verklig sådan klassificeringsincident efter #146 är belagd här. Detta är en ny kostnads-/latensberoende och felpunkt, inte bevis för den äldre incidentens orsak.

**Åtgärd:** samla uppdragsförståelse och genomförandekontroll generellt, med en definierad återhämtningsväg. Gör inte alla uppdrag beroende av varje ny specialklassificerare. Bestäm tydligt vad ett anropsbudgetvärde respektive databasvärde betyder och mät faktisk latens och kostnad.

Källor: `project-answer.ts`, `project-delivery.ts`, `ask-openai.ts`, `openai-service.ts`.

### A8 — P2: Framgångsmätningen döljer varför jobbet inte blev gjort

Dagens lästa usage-aggregat innehöll 78 huvud-Bob- och 13 CAD-anrop, alla markerade lyckade; `latency_ms` var tomt. Det är providerresultat över olika användningar/tester, inte 91 slutförda uppdrag. Vissa HTTP-/nätverksfel returneras innan usage-loggning. Klassificering och huvud-Bob får samma funktionsetikett.

Verktygsspåren ger namn/status men inte alltid exakt laddat verktyg eller återstående domänbudget. CAD-underverktygens resultat saknar motsvarande beständig, kompakt händelseserie. Bakgrundsreplay återger äldre loggrader; de får inte räknas som nya modellkörningar eller dubbla skrivningar. Att privata råargument rensas efter avslutad tur är inte i sig ett fel.

**Åtgärd:** logga innehållsfria händelser för uppdrag, modellroll, erbjudna/laddade verktyg, budget, faktiskt utförd/replayad operation, valideringskod och avslutsorsak. Mät leveransgrad och nödvändiga följdfrågor separat från providerframgång. Behåll dataminimering; råa samtal eller bilder behövs inte för denna statistik.

Källor: `openai-service.ts`, `project-tools/session.ts`, `bob-job-journal.ts`, `cad-assistant.ts`, avläst usage-aggregat.

### A9 — P2: Rollen lovar mer än hela verktygskedjan täcker

| Arbete | Faktisk kapacitet / gräns |
|---|---|
| Plan och uppgifter | Sammanställning, fokuserad ändring, förslag, beslut, länkar, uppgiftsstatus och tilldelning finns. Flera beroende anrop och korrekt mandat krävs. |
| Mått och lösningar | Spara/revidera/arkivera mått samt spara lösning och välja target finns. Rimliga arbetsval kan sparas som specifikation/uppskattning. |
| Ritning och material | Generell begränsad CAD, exakt sparande och materialbehov från en CAD-definition finns. Komplett större materiallista kräver fler åtgärder än dagens tur kan medge. |
| Bilder | Lista/öppna, nygenerera, koppla och återställa väntande uppladdning finns. Bob har inget verktyg för att ta bort en bildkoppling. Genereringsverktyget lämnar en textprompt, inga referenspixlar, till bildgenereringen. |
| Områdesarkivering | UI har `setAreaArchived` och kanoniskt `area_lifecycle_command`. Bob-katalogen har inget motsvarande verktyg. |
| Byggdagar och deltagare | Skapa/revidera byggdag och koppla uppgifter finns. Det är inte en komplett kedja för inbjudningar, faktisk tillgänglighet, närvaro eller matplanering. |
| Byggkunskap | `search_building_knowledge` söker åtta kurerade referenskort. Det är ingen webbsökning, full bygghandbok eller aktuell produktdatabas. |

**Åtgärd:** prioritera saknade generella handlingar efter användarfallen och exponera befintliga kanoniska kommandon med samma behörighet/revisioner. Beskriv kvarvarande produktgränser tydligt. En ny verktygspost utan genomförandeprov räcker inte för att kalla förmågan färdig.

## Rekommenderad ordning

1. **Snabba, avgränsade förbättringar:** rätta söktriggers/alias, förbättra valideringsfel, visa återstående budget och gör testkatalogen representativ. Rätta dokumentationsdrift utan att kalla beteendet löst.
2. **Störst effekt:** generell uppdragsstatus och leveranskontroll, säkert genomförande över delbudgetar och tillståndsstyrda verktygsuppsättningar. Behåll caller-RLS, revisioner, kvitton, osäkra-skrivningar-stopp och faktiska ägarbeslut.
3. **Ritningskvalitet:** återför deterministiska förhandsbilder, kontrollera orientering/uttryckliga krav och behåll numerisk kontroll.
4. **Verklig acceptans innan stängning:** kör följande matris med samma modell först. Därefter kan modell/reasoning jämföras på observerat resultat, kostnad och tid.

| Prov utan verktygsnamn i frågan | Godkänt resultat |
|---|---|
| Skapa och ändra uppgift | Rätt befintligt Step, bevarat innehåll, exakt skrivkvitto och återläsning |
| Flytta/ta bort ett plansteg | Endast avsedd ändring, bevarade uppgifter och aktuell planrevision efter auktoriserat beslut |
| Rita nytt objekt med saknat target | Rimliga delegerade förberedelser, faktisk sparad geometri, rätt steglänk och användbara vyer |
| Ändra orientering efter referensbild | Samma Artifact, ny revision, rätt sida enligt sparade riktningar och visuell kontroll |
| Materiallista större än åtta poster | Spårbar beräkning och säker fortsatt bearbetning utan tappade eller dubbla poster |
| Informationsfråga / avbryt | Relevant svar respektive stopp, inga obeställda förändringar |
| Verktygsfel / timeout / återbesök | Kvitton bevaras, ärlig blockerare, säker fortsättning utan ny mandatloop |

## Reproduktion och begränsningar

Kör `node --import tsx scripts/audit-bob-runtime.ts` för den daterade produktionskatalogen, eller lägg till `--seed` för jämförelse. [Skriptet](../scripts/audit-bob-runtime.ts) använder riktiga sessioner, parsers, budgetar och orkestrering; modell och transporter är uttryckligen syntetiska. [Katalogfixturen](../scripts/fixtures/bob-tool-catalog-2026-09-25.json) innehåller endast offentligt läsbar verktygsmetadata, inga privata projektposter. Den är historiskt underlag, inte ny runtime-policy. Provet verifierar mekanik och positiva kontrollfall, inte hur ofta en verklig modell gör ett visst val.

Den privata körningen har granskats genom avgränsad läsning av tillstånd och innehållsfria loggar. Privata meddelanden, mått, bilder, person-/projektidentifierare och autentiseringsmaterial ingår inte i rapport eller fixturer. Ingen ny privat skrivande modellkörning utfördes: en namngiven appsession saknas i granskningsmiljön. Tidigare gästprov bevisar delar av läsning och CAD-kapacitet, inte denna slutacceptans. Inga runtime-ändringar ingår i auditens reproduktioner.
