# Plan: från spårade fel till ett verifierat Bob-flöde

Planerad 2026-10-19 efter [spårningen av konstruktionsvägen](https://github.com/EmelieHagander/Bob-the-builder/blob/e688c0ded5872bdcaa6516c38b31dec10bbfaeb1/Docs/bob-construction-path-audit-2026-10-19.md).
Detta är en genomförandeplan, inte en genomförd rättning eller releaseacceptans.

## Mål och arbetsordning

Bob ska kunna slutföra en avgränsad konstruktionsändring och leverera dess
kontrollerade ritning utan att återskapa oförändrade data, fastna i omläsning eller
tappa verktyg/arbetstillstånd. Cirka $1 per jämförbar färdig uppgift är ett mjukt
mål. Inga nya hårda kostnads-, tids- eller steggränser införs.

Leverans 1–3 får varsin granskningsbar PR. Leverans 4 färdigställer de befintliga
utkasten #285 och #286. Riktade lokala tester efter varje leverans; nästa börjar
när de relevanta kraven passerat. Ingen ny dyr livekörning
under implementationen. Hela sviten och full CI körs först vid slutgrinden, efter
att det samlade beteendet har verifierats lokalt. Inga workflow-förändringar görs
för att dölja eller kringgå CI. Förberedande commits behåller `[skip ci]`.

#285 och #286 finns redan som oaktiverade utkast. De ska uppdateras och byggas om
ovanpå konstruktionsrättningarna, inte deployas först och sedan kompenseras med nya
undantag. Den redan driftsatta checkpointåterupptagningen behålls.

## Leverans 1 — små konstruktionsändringar och precisa fel

**Problem:** tre nya lådvolymer krävde tre fullständiga dokumentförslag. Ett saknat
metadatafält och en oavsiktligt ändrad befintlig fog gjorde omförsöken dyra.

- Återanvänd `change_construction_parameters` för befintliga indata och
  `change_construction_roles` för roller. Inför ett smalt, typat kommando för
  tillägg/ändring/borttagning av konstruktionsposter där de verktygen inte räcker.
- Kommandot anger konstruktion, förväntad revision, avsedd ändring och stabil
  skrivnyckel. Servern hämtar originalet och sammanfogar ändringen. Modellen skickar
  bara berörda delar och nödvändiga parameter-/material-/fog-/rollposter.
- Bevara befintliga identitetsregler: en omkopplad fog eller annan ny betydelse får
  inte maskeras som samma historiska identitet. Borttagningar måste hantera kända
  beroenden uttryckligen; inga tysta standardvärden eller godtyckliga JSON-sökvägar.
- Kör befintlig kompilering, källkontroll, databasvalidering och skrivliggare på
  resultatet. Förväntad revision och rättigheter kontrolleras vid skrivning.
- Returnera tillåtna strukturerade domänfel med berört ID/fält och vad som behöver
  rättas. Exempel: saknad ändringsnotering eller samma del i fogens båda ändar.
  Okända interna fel förblir skyddade; skicka inte råa databasfel till modellen.
- Fullständig skapandeväg finns kvar för nya konstruktioner; den ska inte vara
  normalvägen för en liten ändring i något redan sparat.

**Grönt när:** en syntetisk motsvarighet till sängen får tre nya delar medan alla
gamla poster förblir exakt oförändrade. Testa också en tillåten ändring och
borttagning med beroenden, självkopplad fog, ofullständigt underlag, ändrad revision,
indragen behörighet och avbrott efter skrivning men före kvittens. Exakt återförsök
ger samma kvitto och endast en ny revision; ändrat innehåll med samma nyckel avvisas.
Felrättning kräver bara det lilla ändringspaketet. Ingenting skrivs vid ogiltigt paket.

**Berör:** `construction-draft.ts`, konstruktionskompilering, `project-write.ts`,
kanoniska SQL-kommandon/skrivliggare, verktygskatalog och relevanta checkpointkontrakt.

## Leverans 2 — relevanta läsvyer och bibehållna arbetsresultat

**Problem:** läsning av en enda konstruktion skickar hela dess interna tillstånd.
Korta transportsidor väljer inte automatiskt rätt innehåll.

- Standardläsningen ger en liten översikt: exakt revision, omfattning, källstatus,
  kontrollstatus, blockerare och hur detaljer öppnas. Separata vyer för berörda
  delar, parameternoder/beroenden, fogar, material och kontrollfynd.
- Gör beroenden och återstående täckning synliga. En kort vy får inte dölja en
  styrande begränsning eller få okänd information att framstå som verifierad.
- Låt servern läsa full konstruktion för kontroller, sammanfogning, plock-/kaplistor
  och rendering. Leverera bilder som bilder, inte som stora textrepresentationer.
- Återanvänd redan observerade resultat genom exakta revisionsbundna referenser.
  Visa att en kontroll redan är gjord och vad som ändrats sedan dess. Skillnaden
  mellan historiskt resultat och en ny kontroll av aktuella källor ska vara tydlig.
  Återanvändning ersätter aldrig rättighets- eller färskhetskontroller inför skrivning.
- Lagra nytt arbetsläge/nya referenser i checkpointkontraktet och testa återställning.

**Grönt när:** samma relevanta mått, beroenden och kontrollfynd går att nå från små
vyer, även när avgörande data ligger sent i ett stort underlag. Tester verifierar
fakta/täckning och exakta referenser, inte bara antal tecken. Hela konstruktionen
passerar inte huvudmodellen när uppgiften bara berör en del.

**Berör:** konstruktionsläsare, list-/kontrollresultat, projektkontext och exakt
resultatåterläsning i #286.

## Leverans 3 — rätt verktyg och verkligt avgränsat arbete

**Problem:** ett arbetsflöde laddar 19 fulla scheman samtidigt. Den gamla delkön
avlastar först när konstruktionerna redan är färdiga.

- Skilj på kort verktygsförteckning, arbetsmetod och de scheman som behövs för
  aktuell deluppgift. Ett valt arbetsflöde ska inte automatiskt ladda hela gruppen.
  Laddad kunskap och verktygens tillgänglighet ska bestå efter återstart.
- Ha en auktoritativ kopia av respektive manual/schema i varje komplett begäran.
  Hänvisa till den i historiken där det går utan att förlora nödvändig instruktion.
- Arbetsmetoden väljer befintliga parameter-/rolländringar, det nya avgränsade
  konstruktionskommandot eller naturliga delkonstruktioner utifrån uppgiftens form.
  Dela inte automatiskt en liten sängändring i flera separata ritningsjobb.
- Återanslut repetitionsbeskrivningar till den kanoniska konstruktionskompileringen
  där de minskar noder som modellen annars måste skriva. Servern expanderar och
  validerar; test visar samma slutgeometri, bindningar och källhänvisningar.
- För större nya byggen: arbeta med en naturlig delkonstruktion i taget och spara
  dess resultat innan nästa. Bevara gemensamma koordinater, gränssnitt och källor.
  Använd sedan den befintliga delritningskön. Återställ inte pensionerade CAD-kollegor
  eller en parallell konstruktion som kan avvika från den kanoniska modellen.
- Om ett obligatoriskt underlag fortfarande kräver stor ostrukturerad tolkning,
  lägg in en mindre läsmodell med avgränsad fråga, exakta källreferenser, explicit
  osäkerhet och inget skrivmandat. Den behövs inte för att sammanfatta strukturerade
  konstruktionsdata som servern redan kan välja/beräkna deterministiskt.

**Grönt när:** återstart bevarar instruktioner och anropsmöjlighet, arbetsflödesval
slutar expandera alla scheman, repetitionsformen ger samma validerade konstruktion,
och flera delkonstruktioner kan färdigställas utan att varje del får alla andras
rådata. Den mindre läsmodellen införs bara om ett konkret kvarvarande behov beläggs.

## Leverans 4 — färdigställ #285/#286 och verifiera hela kedjan

- Anpassa kompletta modellbegäranden i #285 till de nya små vyerna och verktygsytan.
  Samma ordning och exakta verktygs-/källversioner i varje begäran; ingen dold
  OpenAI-kedja behövs i det nya huvudflödet.
- Färdigställ #286:s exakta resultatarkiv, små referenser och återöppning. Ingen
  AI-sammanfattning mitt i huvudturen; efterföljande samtalsminne är ett separat flöde.
- Behåll versionsstyrning för redan pågående jobb. Ta bort föråldrade vägar först
  när det är verifierat att inga jobb behöver dem. Ingen automatisk fallback som
  omtolkar ett nytt jobb med gammal semantik.
- Kör samma sammanhängande scenario: bild → relevant konstruktion → liten ändring
  → exakt kontroll → rendering → granskning → sparad/länkad ritning → svar med kvitto.
  Använd deterministiska provider-/rendererfixturer för avbrottstesterna, utan betalprov.
- Kör minst 40 steg med avbrott/återupptagning, inklusive bilder, tappad kvittens,
  källändring, rättighetsförlust och fel som rättas. Räkna faktiska handler-/DB-anrop
  per omgång och rapportera CPU-mätningarnas miljö och begränsningar.
- Mät promptdelar, antal erbjudna scheman, största resultat och sammanlagd in-/utdata.
  Lägg in realistiskt stora native resonemangsposter i kapacitetsprovet. Ett litet
  syntetiskt resonemang får inte användas som bevis för att långa turer ryms.

**Grönt när:** inga gamla handlers återkörs efter checkpoint, skrivningar dubbleras
inte, manualer och bilder bevaras, referenser öppnar rätt original och huvudturen
inte använder AI-kompaktering. Den samlade fixturen slutar med verifierade kvitton
för både konstruktion och ritning. Ett mellanresultat räknas inte som färdig leverans.

**Öppen kapacitetsfråga:** att behålla allt native resonemang garanterar inte en
slutprompt under 64 000 tokens. Testa den verkliga storleksordningen innan aktivering.
Om kravet inte håller behöver kontraktet för avgränsade arbetsenheter revideras,
med sparade resultat och tydlig överlämning. Varken tyst bortkastat resonemang eller
ett nytt hårt kostnads-/stegstopp får maskera problemet.

## Slutgrind och vad »grönt« betyder

1. **Lokalt grönt:** ovanstående riktade tester och samlad offlineacceptans passerar.
   Jämför med baslinjen och redovisa även mått som blev sämre. Påstå inte att
   skriptade verktygsval bevisar den riktiga modellens beteende eller dollarkostnad.
2. **CI grönt:** först nu körs hela sviten och ordinarie CI på exakt releasekandidat.
   Granska även migrationsordning, katalog-/runtime-kompatibilitet och återställning.
3. **Tekniskt driftsatt:** kompatibel serverkod, schema och katalog publiceras i
   rätt ordning. Läs tillbaka versioner och kontrollera pågående jobb; mät driftens
   CPU separat från lokala Node-prov. Draftstatus är inte ett releasekvitto.
4. **Beteende och ekonomi verifierade:** verklig modellväg levererar rätt resultat,
   rimligt få meningsfulla steg, inga stopp/dubbelsvar och uppmätt kostnad/cache.
   Det kräver till sist verklig användning. Planen startar inte ett nytt betalt
   långprov: redovisa först kvarvarande risk och kostnadsestimat och välj ett litet
   representativt prov när beställaren vill prova igen. En sådan liten kontroll
   stänger inte automatiskt grinden för ett långt bildjobb.

Rapportera varje grind separat. Slutmålet är färdig korrekt leverans omkring $1;
ett lågt tokenantal, lyckad konstruktion utan ritning eller grön CI ensam räcker inte.

**Första genomförandeuppgift:** specificera det smala konstruktionskommandot och
dess felkontrakt mot sängens tre tillagda delar, därefter implementera leverans 1
med riktade lokala tester. Inga nya driftförsök behövs för att börja.
