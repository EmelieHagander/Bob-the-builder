# Audit: vad Bob får, ser och kan göra

Datum: 2026-09-24. Granskad kod: `aa9188b0be2bce209faa7fa93a892fa7726adf65`, Ask Bob v28. Produktionsinställningar och verktygskatalog lästes under granskningen. Inga produktionsinställningar eller projektposter ändrades.

Senare granskning: [generell verktygs- och autonomiaudit efter PR #146](bob-tool-autonomy-audit-2026-09-25.md). Modellnamn, verktygsantal och kvarvarande fynd nedan är den historiska baslinjen, inte aktuell driftstatus.

## Uppföljning — korrigeringsbranch 2026-09-24

Baslinjen nedan beskriver v28 och är historisk. #122 rättade modellval, minnessammanfattning, hela planassistentens paginering, storleksfel och tidigare skrivkvitton. Följande integration rättar återstående promptlager och guideleverans samt tillför generella mått-/lösnings-/target-/uppgiftsverktyg, CAD-assistent, bildflöde och detaljläsning av stora plan/CAD-poster.

| Fynd | Kodstatus | Kvar för slutlig stängning |
|---|---|---|
| 1. Ofullständigt urval | Rättat i #122; ofullständiga läsningar stoppar före validering | Verklig modellacceptans över stora projekt |
| 2. Dubbla promptlager | Extra beteendetext borttagen; en systemägare, separat verktygsdata, storleksloggning | Driftavläsning av nya promptstorlekar |
| 3. Saknade förladdade guider | Guide levereras i varje erbjudet verktyg | Ingen känd kodlucka |
| 4. Saknade skrivkvitton | Rättat i #122, även nya dataset följer samma kvitton | Återbesök med verkliga användarsamtal |
| 5. Tomt svar för stor post | Tydligt storleksfel + navigerbar detaljläsning för plan/CAD | Andra stora dataset kan fortfarande behöva egna detaljläsare |
| 6. Saknade förmågor | Nya generella projektverktyg och CAD-/bildintegration implementerade | CAD-hosting och verkliga användarflöden; full flerdagars-/volontärkedja är fortsatt PARTIAL |

Detta är inte ett påstående att alla produktmål är stängda. [CAD-kontraktet](cad-adapter.md) äger driftblockeraren; [mediekontraktet](media-and-steps.md) äger stegkoppling och återhämtning. Befintligt uttryckligt godkännande för kanonisk projektplan är oförändrat; vanliga delegerade arbetsval får göras utan extra bekräftelser.

## Bedömning

Bob har redan en handlingsorienterad roll och stöd för flera handlingar per tur. Hans arbetsmiljö ger honom däremot ojämnt underlag: ytterligare instruktioner tillkommer efter den korta prompten, verktygsguider följer inte automatiskt med förladdade verktyg, och tidigare sparade handlingar försvinner ur nästa turs strukturerade samtalsunderlag. Planassistentens begränsade urval kan dessutom felaktigt stoppa giltigt underlag.

`Autonomy: extra high` finns redan i rollen. Det är text, inte en teknisk inställning som ger mer reasoning, större budget eller fler rättigheter. Fler uppmaningar att vara självgående löser inte de verifierade datagränsproblemen.

Vi har inte bevisat att varje fynd orsakat de tidigare onödiga godkännandefrågorna. Nedan skiljs reproducerade fel, bekräftade begränsningar och möjliga beteendeeffekter åt.

## Vad han faktiskt får

| Del | Faktisk leverans | Betydelse |
|---|---|---|
| Roll och instruktioner | Persona, gemensamma kontrakt, aktuell verktygslista och separat grounding-text | Flera platser påverkar samma beteende. |
| Nuvarande önskemål | Skriven text, högst 4 096 tecken | Ask Bob-anropet tar inte emot ljud eller bifogade filer. |
| Senaste samtalet | Fem individuella meddelanden inklusive aktuellt användarmeddelande | Det betyder fyra tidigare meddelanden, inte fem tidigare dialogvändor. |
| Äldre samtal | Rullande sammanfattning, mål 6 000 och max 12 000 tecken | Kan förlora detaljer; är inte aktuell projektstatus. |
| Exakt äldre historik | Verktyg, fyra sökningar per tur, fem meddelanden per sida | Bara den aktuella privata tråden, inte andra medlemmars konversationer. |
| Projektstatus | Färsk projektpost med bland annat planbriefing; ytterligare data via verktyg | Ingen automatisk fullständig läsning av alla projektposter. |
| Sparade handlingar från tidigare turer | Inte som kvitton i samtalshistoriken | Kan återfinnas som projektposter, men Bob behöver läsa dem på nytt. |
| Bilder | Först metadata; valda bildpixlar efter `open_project_item` | Listning är inte samma sak som att se bilden. Pixlar följer inte automatiskt med till nästa användartur. |
| Externa källor | Ingen aktiverad webbsökning i detta flöde | Kan inte själv slå upp aktuella tillverkaruppgifter via sina nuvarande verktyg. |

Huvud-Bob kör i produktion på `gpt-5.4-mini`, reasoning `low`, konfigurerad outputbudget 16 000 token. Planens sammanställare kör också mini/low, medan granskaren kör `gpt-5.4-nano`/low. Sammanfattningen av äldre samtal använder samma inställningsrad som huvud-Bob. Detta är verifierad konfiguration, inte ett bevis för att modellvalet ensamt orsakar beteendet.

Alla dessa modellkörningar går genom den gemensamma `callOpenAIResponses`-vägen och dess AI-inställningar. Granskningen fann ingen separat provider-väg som kringgår den arkitekturen. Granskaren är rådgivande; deterministiska serverfel kan däremot stoppa sparandet.

## Prioriterade fynd

### 1. Giltiga källor utanför assistentens urval blir blockerande fel — P1, reproducerat

Planassistenten läser en sida vardera av åtta dataset och högst två sidor av uppgifter och mått. Därefter betraktar lokal validering ett exakt ID utanför urvalet som `unknown_evidence_id` eller `unknown_task_id`. `snapshot_partial` hindrar inte detta från att bli ett blockerande serverfel.

En isolerad reproduktion med 51 giltiga måttposter gav: 50 poster i underlaget, `snapshot_partial=true`, `server_validation.valid=false` och `proposal_ready=false` för mått 51. En separat exakt läsning hittade samma mått. När samma plan pekade på första sidans mått passerade den. Modellresultaten var kontrollerade fixturer; ingen riktig modell eller produktionsskrivning behövdes för att utlösa felet.

**Åtgärd:** slå upp refererade ID:n exakt inom samma projekt och behörighet innan de förklaras ogiltiga. Behåll kontroll av schema, projektåtkomst och revision. Ett begränsat urval får inte behandlas som en fullständig förteckning.

Källa: `supabase/functions/_shared/plan-assistant.ts`, `buildSnapshot`, `localValidation` och `serverValidation`.

### 2. Kort prompt mäts före sista instruktionslagret — P1, verifierat

`createGroundedModelCall` lägger alltid till 382 ord ur `BOB_GROUNDING_RULES`. Den innehåller ytterligare roll-, evidens- och handlingsinstruktioner. Formuleringen om att föreslå vanliga designbeslut ger en annan betoning än personans uppdrag att fatta arbetsbeslut och utföra arbetet. Det kan bidra till tveksamhet, men just den beteendeeffekten är inte isolerat uppmätt.

Den tidigare uppgiften om 765 ord var ofullständig. Mätning av den faktiska sammansättningen, med produktionskatalogen och tillgängliga planeringsverktyg i en kontrollerad körning, gav:

| Mått | Resultat |
|---|---:|
| Persona | 201 ord |
| Grundsystemprompt med tom verktygslista | 765 ord |
| Extra grounding-text | 382 ord |
| Sammansatt systemprompt i planeringsläget | 1 601 ord |
| Erbjudna verktyg i samma körning | 17 |
| Serialiserade verktygsscheman, utöver systemtexten | 18 777 byte |

Ord och byte är inte token. Projektdata, samtal och senare verktygsresultat tillkommer. Tillgängliga verktyg varierar med fas, budget och tillstånd.

**Åtgärd:** en kort, sammanhängande rolltext och en tydlig ägare för gemensamma kontrakt. Flytta relevant API-vägledning till verktygen, ta bort dubbleringar och mät hela utgående modellunderlaget. Skriv inte fler regler för varje enskilt misslyckat samtal. Behörighets- och datavalidering ska fortsatt ligga i kod.

Källor: `bob-prompt.ts`, `project-answer.ts`, `project-grounding.ts`, `tests/bob-prompt.test.ts`.

### 3. Verktyget är tillgängligt innan användningsguiden har levererats — P1, verifierat

Förladdade verktyg får katalogens korta beskrivning och kodens parameterschema. `how_to` och kodens utförligare verktygsbeskrivning returneras först genom `load_tool`. Bob kan alltså anropa ett redan tillgängligt verktyg utan att ha fått dess guide.

I reproduktionen saknades måttverktygets guide i modellunderlaget och kom fram först efter ett uttryckligt `load_tool`. Detta visar leveransglappet; det visar inte att Bob aldrig själv laddar guiden. Verktygens korta beskrivningar upprepas samtidigt både i systemtexten och i schemasamlingen.

**Åtgärd:** leverera nödvändiga instruktioner när en förmåga erbjuds första gången, även vid förladdning. Håll dem korta. Låt användaren slippa konsekvenserna av att samma verktyg har två olika vägar till sin dokumentation.

Källa: `project-tools/session.ts`, `surfaceSpec`, `prepare`, `load_tool`.

### 4. Utfört arbete saknar strukturerad kontinuitet — P1, verifierad begränsning

Ny användartur börjar utan föregående provider-response-ID. Historikens meddelanden innehåller `seq`, roll, text och leveransstatus, men inga sparade verktygskvitton, bildreferenser eller verktygsresultat. Sammanfattaren får samma textbaserade underlag. Den uppmanas att skilja sparat arbete från påståenden om sparande, men får inte själva kvittona.

Fixen i #121 ger nu projektbriefingen en referens till väntande planförslag. Den löser det observerade fallet där ett sparat förslag inte hittades vid godkännande. Motsvarande robust kontinuitet saknas fortfarande generellt för andra handlingar.

**Åtgärd:** ge nästa tur ett kompakt, serverbyggt arbetsläge: senaste verifierade ändringar, öppet uppdrag, relevanta rekordreferenser och verkliga blockerare. Tidigare kvitton visar vad som hände; färska projektläsningar avgör vad som gäller nu. Historik får inte kunna tillföra nya behörigheter.

Källor: `bob-working-context.ts`, `project-answer.ts`, migrationerna `20260918194106_ask_bob_context_memory.sql` och `20260924050007_bob_pending_plan_context.sql`.

### 5. En stor post kan bli ett tomt, framgångsrikt svar — P2, reproducerat

Projektläsningen begränsar resultatet till 32 KiB genom att ta bort hela poster. En ensam planpost över gränsen kan därför ge `status=ok`, `records=[]`, `truncated=true`, `next_cursor=null`, även vid exakt ID-läsning. En fixtur på cirka 40 KB reproducerade detta. Ingen av de granskade incidenterna är bevisad att ha träffat denna gräns.

**Åtgärd:** returnera ett tydligt storleksfel och en fungerande väg till detaljläsning/delning. Använd inte tomma poster med framgångsstatus för oläsbart innehåll.

Källa: `project-lookup.ts`, bytebegränsningen i `search`.

### 6. Expertrollen är bredare än verktygsuppsättningen — produktgräns

Den aktiva katalogen har 25 domänverktyg; ett äldre assistentverktyg är inaktivt. Bob kan bland annat skriva projektbeskrivning, arbetsuppgifter, mått med angiven sanningsstatus och planförslag samt hantera planbeslut och länkar. Han kan redan spara ett arbetsmått som `provided_spec` eller `estimated`; allt behöver inte bli `measured` eller föregås av en ny bekräftelse.

Viktiga begränsningar:

- `save_project_task` kan skapa eller ändra namn/instruktioner, men inte ändra status eller tilldela personer.
- Det finns inget registrerat Bob-verktyg för att skapa en SolutionVersion eller välja target, trots att flera ritverktyg kräver ett valt target.
- Möbelritverktyget stöder en öppen rektangulär förvaringslåda. Det kan inte skapa en våningssäng eller en generell konstruktion.
- Planassistenten får inte Bobs hela samtal, bildpixlar eller fysiska byggnadsmodell. Ritningsposter reduceras till metadata, utan geometrin. Bob behöver föra relevant avsikt vidare genom `plan_intent`.
- Att göra ett förslag till godkänd projektplan kräver uttryckligt godkännande enligt nuvarande kontrakt. Det är en avsiktlig regel, skild från tillåtelsen att själv spara arbetsmått och göra vanligt delegerat arbete.

**Åtgärd:** gör kvarvarande produktbeslut tydliga: vilka reversibla arbetsbeslut ingår i projektmandatet, vilka åtgärder behöver nya verktyg, och vilka ägarbeslut ska verkligen vara uttryckliga? Mer självsäker text skapar inte saknade förmågor.

Källor: produktionskatalogen, `project-tools/bob-tools.ts`, `project-write.ts`, `project-drawing-write.ts`, `project-building-plan.ts`, `project-answer.ts` och `plan-assistant.ts`.

## Budget, uppföljning och sådant som fungerar

- Det finns redan 12 modellrundor, högst 8 verktygsanrop per modellsvar och 8 skrivförsök per tur. Flera handlingar kan utföras i följd; beroenden kräver ofta en ny modellrunda.
- Huvudflödet har 12 projektläsningar. Projektbriefingen tar en. Varje bildbärande modellkörning gör dessutom två automatiska läsningar ur samma budget.
- Total tidsbudget är 215 sekunder. Verktygen stängs på sista rundan eller när mindre än 40 sekunder återstår. Lång sammanfattning och två sammanställning/granskningspar kan minska handlingsutrymmet betydligt.
- Bilder har separata gränser: högst 4 per öppning, 8 totalt och 16 MiB totalt; bara PNG/JPEG/WebP. Åtkomst och bildversion kontrolleras före/efter leverans.
- Projektåtkomst följer anroparens identitet. Skrivningar använder revisioner, turn-koppling och kvitton. Osäkra skrivresultat ska inte upprepas blint. Dessa skydd ska behållas.
- Senaste dygnets lästa användningsaggregat visade 124 lyckade ask-bob-provideranrop, med i snitt 9 109 inputtoken och högst 27 236. Sammanfattningsanrop ingår i samma kategori. Lyckat provideranrop betyder inte slutfört användaruppdrag. Latensfälten var tomma.

Logga därför även vilken prompt-/verktygsversion som levererades, budget vid stopp och om uppdraget avslutades med handling, nödvändig fråga eller tekniskt hinder. Gör detta utan att rutinmässigt logga privata meddelanden eller bildinnehåll.

## Rekommenderad ordning och acceptans

1. Rätta exakt-ID-validering och läsningen av stora poster. Det är verifierade hinder som instruktioner inte kan lösa.
2. Samla rollen och kontrakten, leverera nödvändiga verktygsguider konsekvent och mät hela modellunderlaget.
3. Lägg till strukturerad kontinuitet för utfört arbete och öppna uppdrag.
4. Utvärdera huvud-Bobs reasoning och modellval separat från sammanställare, granskare och minnessammanfattare, mot samma verklighetsnära uppgifter. Behåll den gemensamma AI-vägen.
5. Prioritera saknade verktyg utifrån vad Bob faktiskt förväntas kunna slutföra i projekten.

Acceptans ska handla om resultat, inte ett exakt ordval: Bob registrerar ett underbyggt arbetsmått med rätt sanningsstatus, behåller fysisk kontroll som öppen uppgift och fortsätter med oberoende arbete. Efter ett tydligt godkännande hittar han det sparade förslaget, genomför beslutet och fortsätter inom uppdraget. Ett vanligt ”fortsätt” ska inte starta en ny bekräftelseslinga. Ett verkligt ägarbeslut eller en fysisk observation ska däremot efterfrågas när arbetet faktiskt beror på det.

## Verifiering och begränsningar

Auditen kombinerar kodläsning, produktionskonfiguration, verktygskatalog, avgränsad samtals-/användningsdata och isolerade körningar av riktiga runtime-funktioner med kontrollerade transporter och modellsvar. Reproduktionerna verifierade promptleverans, guideleverans, storleksgränsen och snapshot-valideringen, inklusive positiv kontroll.

Ingen ny konversation efter v28 hittades i de två granskade projekttrådarna vid kontrollen. Därför finns ännu inget nytt live-bevis för Bobs beteende efter #121. Ingen namngiven användarsession användes för ett nytt end-to-end-prov, och inga privata konversationstexter eller personidentifierare återges här. Auditen ändrar inte runtime eller produktionsdata.
