# Bob: kostnad, informationshämtning och sammanhängande ändringar — 2026-10-28

**Daterad analys från pausen, följd av implementeringsbeslut 2026-10-28.**
Ägaren godkände därefter de fyra kod-/verktygsförslagen nedan med agentprompterna
orörda. Deras nuvarande kontrakt finns hos
[verktygsägaren](../ask-bob-tools.md#coherent-construction-work); denna analys
bevarar underlag och rekommendationer. Nano/Mini och betald jämförelse är fortsatt
uppskjutna. Aktivt nästa arbete ägs av [State](../bob-delivery-flow.md#state).
Beslut hör till befintliga ägare för
[kontext](../ask-bob-context.md), [verktyg](../ask-bob-tools.md),
[konstruktioner](../artifacts.md) och [leverans](../bob-delivery-flow.md).

## Rekommendation

Gör **samlat underlag → sammanhängande ändring → samlad kontroll** till den
generella arbetsformen för en avgränsad uppgift. Låt kod samla exakta fakta,
beroenden, rättigheter och revisioner. Lägg en eventuell Nano-/Mini-läsare
**inne i informationshämtningen**, där tolkning eller urval av ostrukturerade
källor behövs. Bob ska få ett användbart arbetsunderlag från den operationen.

Det är två kompletterande delar. En billigare läsare kan avlasta källarbete,
men den samordnar inte automatiskt skrivningar, versionsbyten eller leverans.
Det finns redan bra byggstenar för samlade ändringar. Nästa arbete bör koppla
ihop dem runt uppgiften, med återanvändning av giltiga resultat, i stället för
att börja om med ännu en generell agent eller fler beteenderegler i prompten.

### Konkreta ändringsförslag efter ägarens förtydligande

**Agentprompterna lämnas orörda.** Ägaren har uttryckligen avgränsat nästa
lösning till andra förändringar. Följande är kod-/gränssnittsförslag; ingen
implementation eller aktivering har startats genom förtydligandet.

1. **En samlad arbetsvy i befintlig konstruktionsläsning.** Bygg vidare på
   `read_construction_draft` och återanvänd insamlingen i `read_task_sources`.
   För en befintlig Construction ska en läsning kunna ge redigerbara indata,
   berörda delar/beroenden, material, styrande Solution-/Step-krav och exakta
   revisioner tillsammans. Bob anger objekt och eventuell berörd scope;
   servern följer beroenden och sidning. Behåll tydlig täckning och vidare
   läsning för stora eller ofullständiga underlag. Befintliga detaljvyer finns
   kvar. För nytt arbete utan Construction används samma källinsamling med
   uttryckligt saknat konstruktionsunderlag.
2. **Gemensam serverväg för en sammanhängande ändring.** Återanvänd parameter-
   och delverktygens typade ändringar och kompilering. Lägg samordningen av
   uttryckligen begärd Solution-ändring och Construction-ändring i servern.
   För ändringar som berör båda föreslås en gemensam databastransaktion med
   förväntade revisioner, bevarad identitet och ett återanvändbart kvitto.
   Rendering sker efteråt via befintligt bakgrundsarbete om den är beställd.
   Det nya här är revisionssamordning och helhetsresultat; flera parameter-
   eller deländringar per anrop stöds redan.
3. **Ett komplett kontrollresultat för kvittots revision.** Utöka befintlig
   kontroll-/leveransväg så att källstatus, genomförda tekniska kontroller,
   samlade kända fel och efterfrågade leveranser kan bedömas tillsammans.
   Återanvänd giltiga tidigare bevis. Returnera täckning och begränsningar;
   tillverknings- och bildgranskning får inte bli godkända genom en enklare
   geometrikontroll. Ritning/listor kontrolleras som leverans när de ingår i
   beställningen, inte som obligatoriskt extraarbete vid varje ändring.
4. **Ta bort onödiga mellanrundor runt dessa operationer.** Låt den befintliga
   verktygssessionen erbjuda relevanta nästa verktyg direkt när deras faktiska
   förutsättningar är uppfyllda. Scheman och beskrivningar läses från katalogen;
   högst sex kärnverktyg är permanent laddade. Återanvänd arbetsunderlag och
   kontrollresultat för samma revisioner/scope/källor med ny åtkomstkontroll.
   Lägg innehållsfria mätpunkter för ny läsning, återanvändning, revisionsbyte,
   felrättning och verklig leverans, så att effekten går att bedöma.
5. **Nano som senare utbytbart läsalternativ.** Om strukturerad källinsamling
   fortfarande lämnar dyrt texturval åt Bob, ge den befintliga läsarrollen
   begränsade sök-/öppningsmöjligheter och fullständig relevant sidning.
   Jämför Nano, Mini och kod utan läsarmodell på samma underlag och med samma
   huvudmodell. Exakta fakta och skrivningar stannar i de ordinarie kodvägarna.

Förslag 1–4 bör utgöra en sammanhängande leverans för en befintlig
konstruktionsändring, med fokuserad lokal verifiering av hela kedjan före
eventuell aktivering. Exempel: bredd 500 mm och djup 350 mm ska kunna ändras
tillsammans, med samtliga berörda följdmått och källkopplingar korrekta efter
en ny Construction-revision. Detta är ett föreslaget prov, inte ett uppmätt
modellutfall. Nano läggs inte in som obligatoriskt nytt led före detta prov.

## Vad körningen faktiskt visar

Underlag: [releasebevis och kostnadsredovisning](../foundation-verification.md#form-package5-release-2026-10-28)
för [körning 40716168468](https://github.com/EmelieHagander/Bob-the-builder/actions/runs/40716168468),
kompletterat med läsning av dess innehållsfria `bob.execution_events`.

| Mått | Observerat | Slutsats och begränsning |
|---|---:|---|
| Modellanrop | 72 | Tre användarturer: skapa låda, ändra bredd, ta fram ritning. |
| Huvud-Bob | 70 anrop; USD 3,085053 | 96,75 % av loggad modellkostnad. Baslinjen körde GPT-5.4 **high**. |
| Total modellkostnad | USD 3,188723 | USD 2,25 var en avläst kostnad medan arbetet pågick. Beloppet är loggad modellkostnad, inte en full infrastruktur-/fakturaavstämning. |
| Verktygsanrop | 116, fördelade på 21 verktyg | 9 anrop fick `saved`. Antal kvittorader är ett annat mått. |
| Verktygsbeskrivningar | 31 | Tio modellrundor innehöll bara `describe_tool`, tillsammans USD 0,401794. |
| Konstruktionsläsningar | 30 i 12 modellsteg | Olika vyer, sidor och färskhetskontroller kan vara nödvändiga; dessa är inte bevisligen 30 dubbletter. |
| Modellsteg med verktyg | 60, varav 23 med flera verktyg | Upp till sju verktyg i samma svar. Runtime utför dem sekventiellt; det är inte sju parallella skrivningar. |
| Slututfall | Ny Construction skapades vid reparation; leveransstatus `partial` | Sluttexten sade färdigt. Körningen uppfyllde inte scenariots identitets-/leveranskrav. |

Det var alltså inte 116 små ändringar. Breddens lyckade parameterändring
gjordes redan i ett anrop med kodberäknade följdändringar. Kostnaden ligger i
huvudmodellens många rundor för upptäckt, läsning, planering och reparation.

Baslinjen kan inte bevisa den minsta nödvändiga anropsmängden. Kompletta
argument för avvisade anrop och avslutade arbetsjournaler finns inte kvar.
Vi kan därför inte förklara varje `invalid` eller avgöra exakt vilka läsningar
som var identiska. De tre senare användarinstruktionerna kunde heller inte
utföras innan användaren gav dem.

## Tidigare varianter: vad blev faktiskt byggt?

| Spår | Verifierat läge | Betydelse för dagens beslut |
|---|---|---|
| Projektbibliotekarie / ContextRouter | Bredare målbild finns. [26 oktober-granskningen](bob-project-context-audit-2026-10-26.md) fann ingen komplett exekverbar generell bibliotekarie. Startorientering ersattes med kodhämtade projektfakta. | Det finns inget belägg för ett färdigt Nano-hämtningssystem som provats och förkastats. |
| Samtalsminne och Mini-hjälpare | `context-summary` sammanfattar privat historik; andra roller bearbetar redan tillförd kontext. Flera äldre komprimeringsvägar kringgås av dagens resultat-/projektfaktaväg. | En sammanfattare av tillförd text är ingen självständig sökare över projektet. Återinför inte extra sammanfattningsled på varje tur. |
| Nano | Katalogens `tier.nano` är GPT-5.4-nano, kopplad till aktiverad plan-reviewer. | Det är en annan uppgift. Den daterade granskningen fann ingen Nano-användning 19–26 oktober. Den aktuella eventfrågan sedan 19 oktober fann inga modellhändelser för plan-reviewer, source-reader eller memory-agent; detta är begränsat till den lagrade telemetrin. |
| `memory-agent` | Katalogförslag, avstängd; ingen motsvarande generell projektläsare i runtime. | Namnet är inte bevis för levererad förmåga. |
| [`read_task_sources`](../ask-bob-context.md#read-task-sources) | Installerat 28 oktober, policy avstängd. Kod läser vald Solution, Step-krav och Construction-översikt. | Bra grund för styrande källor. Saknar ett komplett uppgiftsanpassat ändringsunderlag. |
| [`read_source_findings`](../ask-bob-context.md#source-reader) | Installerad men avstängd Mini/low-roll. Modellen får ett fast urval texter, inga sök-/öppningsverktyg. | Den tolkar det som servern redan hämtat. Den kan inte själv leta upp saknade parametrar, fler sidor, äldre original eller bilder. |

De sista två delarna var avsiktligt publicerade inaktiva i väntan på jämförelse.
Deras lokala tester visar tekniska gränser, inte att en verklig läsarmodell
bevarar alla krav eller sänker totalkostnaden. Historiken visar en återkommande
arkitekturidé och stegvis byggda delar, men ingen verifierad hel lösning.
Bedömningen bygger på repo, GitHub och lagrad runtimeinformation; tidigare
chattar kunde inte komplettera underlaget eftersom Personal Context är avstängt.

## Samlade fynd och status

| Fynd | Vad som är löst eller finns | Kvarstående åtgärd på rätt nivå |
|---|---|---|
| **1. Upptäckt tar egna dyra modellrundor.** | Sex katalogägda kärnverktyg och GPT-5.4 medium är [installerade](../foundation-verification.md#bob-cost-controls-2026-10-28). | Bevisa faktisk effekt. Låt vald arbetsoperation exponera nödvändiga nästa verktyg från katalogen, även ett avslutande save, utan extra beskrivningsrundor. Behåll högst sex permanenta kärnverktyg. |
| **2. Läsningen är uppdelad efter datavy, inte efter arbetet som ska göras.** | Små exakta vyer och beroendevy finns. `read_task_sources` samlar styrande källor. | Samla relevanta redigerbara indata, formler, berörda delar, kopplingar, material och krav i ett paket. Beroendevyn säger uttryckligen att nyfunna grannars ytterligare beroenden kan återstå. Fullständighet måste gälla uppgiftens omfattning. |
| **3. Små ändringspaket misstolkas som små arbetsuppgifter.** | Parameterverktyget stöder flera indata; `edit_construction_parts` stöder flera samlingar och deras beroenden; projektändringar kan också grupperas. | Genomför alla kända följdändringar för en avgränsad begäran tillsammans. Bevara små typade patchar och stabila ID:n. Återgå inte till fullständig JSON-omskrivning. |
| **4. Solution och Construction hamnar i olika revisioner.** | Explicit `target_revision` kan nu uppdatera samma Construction genom befintliga käll-/geometrispärrar. | Samordna ordning och resultat för ändringar över domängränsen. Den installerade möjligheten garanterar inte att Bob väljer rätt ordning eller undviker en ersättningskonstruktion. |
| **5. Kontroll, kandidat, save och leverans är olika avslut.** | Befintliga kontroller, kvitton och leveransläsning finns. Runnern kontrollerar nu slutlig identitet, mått och ritningskälla. | Låt serverns fortsättning slutföra avsett arbete och returnera exakt sparad version samt verklig leveransstatus. `candidate_ready`, godkänd granskning och `saved` får inte var för sig bli bevis för hela leveransen. |
| **6. Läsarmodellens täckning och citat ger begränsade garantier.** | Källreferenser, citatkontroll, avkortningsmarkeringar och `model_interpretation` finns. | Hämta saknade relevanta original och håll exakta värden utanför modellens fria omformulering. Verifierat citat är inte verifierad tolkning eller fullständig kravtäckning. Se reproduktionerna nedan. |
| **7. Giltiga resultat återanvänds inte som en generell arbetsenhet.** | Exakta tidigare kontrollresultat kan öppnas; journalen återspelar samma operation. | Återanvänd oförändrat underlag/resultat för samma revision, scope, källor och kontrollversion. Journalåterspelning är inte en allmän cache mellan nya steg. Ny behörighet och aktuell källstatus måste fortfarande kontrolleras. |
| **8. Infrastrukturfel förstärker kostnad och felaktiga slutsatser.** | Tidigare SQL-planering förbättrades i [PR #311](https://github.com/EmelieHagander/Bob-the-builder/pull/311); publicerade mätningar visar 45–49 ms för uppvärmd läsning mot cirka 180 ms tidigare. Ny runner försöker stoppa sitt exakta durable-jobb och sparar om stoppet bekräftats. | Bevara dessa rättningar. Avbruten klient är inte bevis för avbrutet serverarbete. Tillämpa samma säkra återupptagning på samlade operationer och skrivningar med förlorat svar. |
| **9. Telemetrin räcker inte för att skilja nytt arbete från onödigt omtag.** | Modellkostnad, tokenmängd, verktyg, steg och vissa valideringskoder finns. | Lägg till innehållsfria markörer för operation, vy, revisionsbyte, sidning, återanvändning och felgräns. Mät riktig modellväntan och total tid; hämtning av ett redan färdigt asynkront resultat är inte inferenstid. |

[19 oktober-granskningen](../bob-construction-path-audit-2026-10-19.md) visade
fullständiga omskrivningar och felrättningsloopar; de motiverade de numera
installerade avgränsade skrivverktygen. [Issue #307](https://github.com/EmelieHagander/Bob-the-builder/issues/307)
och [#308](https://github.com/EmelieHagander/Bob-the-builder/issues/308)
visar även databasväntan, skilda läsvyer, checkpointfel och glapp mellan
granskad kandidat och sparad ritning. Flera grundfel är redan korrigerade.
Lärdomen är att följa samma uppgift genom **åtkomst → underlag → genomförande
→ faktiskt resultat**, inte att återskapa varje historisk rättning.

### Två reproducerbara begränsningar i den inaktiva läsaren

Två rena lokala funktionsanrop kördes under denna analys, utan modell, nätanrop
eller ändrade projektdata:

1. `verifyFindings` fick källtext och citat **”Bredden är 400 mm.”**, men
   modellpåståendet **”Bredden är 900 mm.”**. Fyndet behölls med
   `quote_verified: true` och `origin: model_interpretation`.
   Funktionen verifierar att citatet förekommer, inte att påståendet följer
   av citatet. Resultatets begränsningstext är ärlig; den inledande
   kodkommentarens starkare formulering om att inte ersätta exakta värden
   beskriver inte en sådan kontroll.
2. `collectReaderSources` fick en Solution-sammanfattning med 2 000 tecken
   följda av **”Stegen ska sitta på höger gavel.”**. Kravet nådde inte
   läsarmodellens indata. `solution:summary` markerades korrekt avkortad.
   Modellen har inget verktyg att hämta fortsättningen med.

Detta är begränsningar i kontraktet, inte observerade felaktiga Nano-svar eller
aktiva produktincidenter. Ett modellbyte löser inte ett krav som aldrig finns
i indata. Före aktivering måste mottagaren hantera avkortning och tolkning
som ofullständigt underlag, med möjlighet att hämta originalet.

## Föreslaget sammanhängande arbetssätt

Tre **logiska operationer** är en bra normalform för en känd avgränsad ändring.
En operation kan göra flera interna dataläsningar eller deterministiska
beräkningar utan att huvudmodellen behöver planera nästa datavy. Det är inte
ett löfte om tre SQL-anrop eller exakt tre debiterade modellresponser; även
slutsvaret behöver normalt en respons. Om skrivningen redan ger giltigt
kontrollbevis ska det återanvändas.

| Operation som Bob beställer | Vad systemet ska leverera |
|---|---|
| **Läs underlaget för uppgiften** | Källbundna krav, befintligt objekt och revision, redigerbara input-ID:n/enheter, berörda beroenden och bevarandekrav, relevanta original/referenser, konflikter samt uttrycklig täckning och luckor. Ett litet projekt kan ge hela relevanta arbetsunderlaget direkt. Ett stort kräver avgränsning med synliga återstående delar. |
| **Genomför hela den kända ändringen** | En typad ändringsbeställning på förväntade revisioner. Servern sammanfogar ändringar, räknar följder, hanterar källkoppling och bevarar identitet. Returnera kvitto, ny revision, vad som ändrats och vilka resultat som återstår eller blivit inaktuella. |
| **Kontrollera det resulterande arbetet** | Kontroll av exakt kvitterad revision och aktuella källor; samlade kända fel/luckor, korrekt täckning och återanvändbara bevis. Vid ritningsbeställning ingår återöppnad sparad ritning/listor och deras faktiska status. En teknisk delkontroll ska inte utges för full krav-, bild- eller tillverkningsgranskning. |

Exempel: ”Gör lådan 500 mm bred och behåll resten.” Underlaget ska göra det
möjligt att identifiera rätt breddparameter och alla påverkade delar direkt.
En ändring ska uppdatera dessa tillsammans och vid behov samordna motsvarande
Solution/Construction-källrevision. Kontrollen ska avse den slutliga versionen,
efter alla styrande ändringar, inte en mellanversion som strax blir inaktuell.

Det finns ännu inget verifierat generellt atomärt kommando för hela
Solution/Construction/leverans-kedjan. Vid implementation måste gränsen väljas:
använd transaktion där ändringarna kan göras tillsammans; annars en hållbar
fortsättning som sparar delkvitton och bara återupptar återstående steg.
Presentera inte en delvis genomförd operation som atomärt lyckad.

För nya idéer, saknade nödvändiga uppgifter, ändrade källor eller verkliga
kontrollfynd behövs ibland mer arbete. Tre operationer är en designprincip,
inte en hård kvot som gömmer ofärdiga krav. Stora uppdrag delas efter
meningsfulla delresultat och beroenden, inte automatiskt en egenskap per tur.

### Nano/Mini inne i läsningen

- Kod levererar strukturerade mått, enheter, formler, ID:n, revisioner och
  behörighetskontroller. Modellen får hjälpa till med urval och tolkning av
  text där detta tillför något.
- Om hjälparen ska **leta själv**, behöver den begränsade läs-/sökverktyg
  genom samma auktoriserade läsare, inklusive fortsättningssidor och exakta
  original. Dagens `source-reader` har inte denna förmåga. För rent strukturerad
  data behövs ofta inget hjälparanrop alls.
- Bob får källpassager, referenser, konflikt-/osäkerhetsmarkeringar och
  täckning tillsammans med fakta. Tolkning får inte tyst ersätta ett mått eller
  göra ett ofullständigt urval till ”alla krav”. Privat historik följer sin
  egen behörighet; projektmedlemskap ger inte tillgång till andras privata chatt.
- Relevant bildinformation måste föras som original till en roll som kan
  granska den; en textläsare ersätter inte visuell kontroll. En utebliven
  läsare ska ge en användbar väg till originalen, utan att förlora uppdraget.
- Återanvänd resultat för exakt samma källrevisioner, fråga och läsarkontrakt,
  med aktuell behörighetskontroll. Begränsa sammanlagd kostnad även över
  återstarter; undvik en obligatorisk ny router/sammanfattare per steg.
- Håll modellval, profil, beskrivningar och verktygsdefinitioner i befintlig
  versionsbunden katalog. Den nuvarande läsaren delar Mini-profil med
  `context-summary`; byt inte globalt den profilen bara för att prova Nano.

**Valet är kod som bas, valfri läsarmodell som tillägg.** Nano är en kandidat
att utvärdera mot Mini och helt kodbaserad hämtning. Billigare enskilda anrop
är ingen besparing om Bob därefter behöver fler rättningsrundor.

## Genomförandeordning efter analysbeslutet

1. **Enas om arbetsenhet och utfall.** Använd befintliga domänägare och
   byggstenar för ett sammanhängande underlag/ändring/kontroll. Behåll de
   installerade sex kärnverktygen och medium-inställningen som jämförelsegrund.
   Undvik att börja med nya promptregler eller att slå på båda inaktiva verktygen.
2. **Bygg och verifiera den kodbaserade kedjan först.** Samma objekt, full
   berörd ändring, revisionssamordning, precisa fel och säker återupptagning.
   Lägg mätningen av arbete/omtag vid samma gräns. Använd fokuserade lokala
   kontraktsprov före betalda modellprov.
3. **Gör läsaren till ett utbytbart tillägg.** Återanvänd käll-/behörighetsvägen,
   lös relevant sidning och skilj exakta fakta från tolkning. Bevisa fallback,
   ofullständig täckning och budget över återstart innan aktivering.
4. **Jämför hela resultatet på samma villkor.** När ett betalt prov beställs:
   kodbas ensam, kodbas + Nano, kodbas + Mini, med samma huvudmodell/profil,
   katalog, källor och scenario. Den gamla high-baslinjen ger bakgrund men
   isolerar inte effekten av en läsare. Börja med billig avgränsad acceptans
   och stoppa vid första felaktiga utfall enligt den installerade runnern.

Ingen av dessa implementationer, aktiveringar eller betalda jämförelser
startas genom den här analysen. Inga nya automatiska kontroller av PR #365
ingår. Det här dokumentet och State bevarar paus och kvarstående beslut.

## Vad som ska avgöra om helheten blivit bättre

Mät **kostnad och tid per korrekt avslutad uppgift**, inte bara pris per
modell eller antal verktyg. Räkna huvudmodell, eventuell läsare, granskning,
omtag och felande försök. Rapportera median/spridning och testantal när flera
prov finns. Godkänd modellrespons är inte godkänd leverans.

| Prov | Nödvändigt utfall |
|---|---|
| Liten ändring med komplett underlag | Ett samlat läsunderlag, en sammanhängande ändring och ett samlat kontrollresultat räcker normalt. Samma Construction och orelaterade delar bevaras. |
| Flera samtidiga ändringar och befintliga beroenden | Alla kända följder hanteras tillsammans; inga felaktiga kopplingar, formler eller tysta standardvärden. |
| Krav efter första sidan, äldre original, motsägande text | Relevant källa hittas eller täckningen markeras ofullständig. Korrekt citat med felaktig tolkning blir inte verifierat mått. |
| Källa eller behörighet ändras under läsning/skrivning | Ny kontroll vid faktisk gräns. Gammalt cacheinnehåll eller gammal granskning ger inte ny skrivrätt eller aktuellt godkännande. |
| Timeout efter genomförd skrivning eller återstart | Samma kvitto återfinns; ingen dubbel konstruktion, betalning eller följdändring. |
| Ritning beställs | Rätt konstruktion/revision, aktuella källor och alla utlovade resultat kan återöppnas. Delvis klart redovisas som delvis klart. |
| Läsaren saknas, avkortar eller väljer fel | Uppgiften kan fortsätta med originalkällor; inga bortglömda krav göms bakom en säker sammanfattning. |

Återanvänd de bredare acceptansfallen i [leveransflödet](../bob-delivery-flow.md)
för låda, våningssäng och större projekt. Ett lyckat lådprov stänger inte alla
kravtolknings- eller leveransfrågor. Faktisk besparingsprocent och bäst lämpad
läsarmodell är fortfarande omätta.

## Evidens och granskningsmetod

- Nuvarande kod: [`task-sources.ts`](../../supabase/functions/_shared/task-sources.ts),
  [`source-reader.ts`](../../supabase/functions/_shared/source-reader.ts),
  [`construction-views.ts`](../../supabase/functions/_shared/construction-views.ts),
  [`construction-parameters.ts`](../../supabase/functions/_shared/construction-parameters.ts),
  [`construction-edits.ts`](../../supabase/functions/_shared/construction-edits.ts),
  [`project-edits.ts`](../../supabase/functions/_shared/project-edits.ts),
  [`project-answer.ts`](../../supabase/functions/_shared/project-answer.ts) och
  [`execution-metrics.ts`](../../supabase/functions/_shared/execution-metrics.ts).
- Historik: [26 oktober-kontextgranskningen](bob-project-context-audit-2026-10-26.md),
  [19 oktober-planen](../bob-green-release-plan-2026-10-19.md),
  [18 oktober-täckningsgranskningen](../bob-context-coverage-audit-2026-10-18.md)
  och [27 september-runtimegranskningen](../bob-ai-runtime-review-2026-09-27.md).
  Historiska fel beskrivs med senare korrigeringar; äldre versioner är inte
  påståenden om dagens runtime.
- Läsning av hosted katalog och verktygspolicy bekräftade inaktiva läsarvägar,
  Mini/low-profil, avstängd memory-agent och konfigurerad Nano-planreviewer.
  Baslinjens eventaggregering bekräftade 116 verktyg, 21 typer, 9 `saved`,
  60 verktygssteg, 23 flerverktygssteg och 12 steg med konstruktionsläsning.
- Två rena lokala reproduktioner av källavkortning och citatverifiering
  beskrivs ovan. Ingen ny modellkvalitet, liveleverans eller besparing mättes.
- Direkt granskning av en agent; ingen separat agentgranskning eller full
  testsvit/CI har körts. Endast dokumentation ändrades under analysen.
