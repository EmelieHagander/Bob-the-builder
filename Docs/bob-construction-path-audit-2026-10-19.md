# Spårning av Bobs tidigare uppdelning — 2026-10-19

**Slutsats:** uppdelningen fanns, men avlastningen följde inte med när konstruktionen
blev den obligatoriska källan för CAD. Delkön finns kvar för redan färdiga,
kontrollerade konstruktioner. Små ändringar av befintliga parametervärden finns
också kvar. Däremot saknas en motsvarande smal väg för att lägga till eller ändra
delar i den kanoniska konstruktionen. Huvudmodellen måste då skicka hela dokumentet.

Detta är en verifierad lucka i övergången mellan två arkitekturer, inte belägg för
att hela ändringen den 14 oktober ska backas. Kravet på en gemensam, kontrollerad
konstruktion före ritning ska bevaras. De pensionerade CAD-kollegorna ska inte
återinföras. Ingen driftkod eller modellinställning ändras i denna audit.

## Underlag och avgränsning

- Kodhistorik: #225 (`cb41b4e`, 8 oktober), #244 (`20336e9`, 11 oktober),
  #252 (`4ab52a6`, 14 oktober), #271 (`6c2167b`, 18 oktober) och arbetsflödeskorten
  (`36480dd`, 18 oktober).
- Driftsatt huvudväg jämförd vid `5806e85`; draft #285/#286 är inte aktiverade.
- Samma sparade jobb som [kostnadsgranskningen](bob-launchpad-migration-audit-2026-10-19.md#offline-cost-review):
  `a307c296-a27f-415d-adba-8ac3e0c86d91`, 19 oktober 14:30–15:05 svensk tid.
- Jobbets låsta katalog `b395affa-abf8-4c14-a5f3-7260139b78a8`, native funktionsanrop,
  bokförd användning, konstruktionsrevisionerna 6/7 och skrivkvittot lästa utan ändringar.
  Privat modellresonemang har inte lästs; endast dess bokförda tokenantal används.
- Avslutets verktygssvar/checkpoints är rensade. Det går därför inte att återge exakt
  varje historiskt felmeddelande eller rekonstruera varje modellinputs innehåll.

## 1. Vad byggdes, och vad ändrades?

| Del | Ursprunglig funktion | Nuvarande väg |
| --- | --- | --- |
| Deluppdrag, 8 oktober | `plan_cad_pieces` köade 2–12 självständiga beskrivningar; ritarkollegan konstruerade och sparade varje del. | Sedan 14 oktober krävs redan sparad och kontrollerad konstruktion för **varje** del innan någon köas. Kön renderar delarna separat. |
| Ändringspaket, 8 oktober | `revise_cad_candidate` skickade ändrade/tillagda/borttagna poster mot senaste lyckade kandidat i samma CAD-konsultation. | Anropsloopen togs bort 14 oktober. Modulen och kvarvarande kontrakt togs bort 18 oktober. Ingen motsvarande generell konstruktionsändring ersatte den. |
| Upprepade delar, 8 oktober | `recipe.arrays` beskrev exempelvis flera ribbor kompakt; kod expanderade dem och deras bindningar. | Anropet till `expandCadArrays` försvann med konstruktionsloopen 14 oktober. Hjälpmodulen finns kvar, men ingen produktionsanropare hittades. Konstruktionens aktuella schema tillåter inte `arrays`. |
| Parameterändringar, 11 oktober | Servern läste konstruktionen och ändrade bara namngivna befintliga indata; geometri räknades om. | Finns kvar och ingår i valt arbetsflöde. Kan inte lägga till delar, material, nya noder/bindningar eller ändra fogar/formler. |
| Skalsammansättning | Sparade delritningar placeras genom versionsbundna referenser. | Finns kvar, men hjälper först efter att delarna är konstruerade och ritade. |

Den gamla kandidatändringen var **inte** en färdig databasändring av en kanonisk
konstruktion: den arbetade mot ett renderingsförsök och saknade det nya kontraktets
material-/fog-/rollhistorik. Återanvänd dess idé och verifierade mekanik där det
passar; återställ inte den gamla modellvägen eller kopiera den som ett fritt JSON-patch-API.

Kodställen: `cad-pieces.ts`, `cad-assistant.ts`, `construction-draft.ts`,
`construction-parameters.ts`, `cad-schema.ts`, `cad-arrays.ts` under
`supabase/functions/_shared/`. Git-diffen för #252 visar borttagningen av
`cad-designer`-loopen, `applyCadRevision` och `expandCadArrays` tillsammans.

## 2. Vilken väg såg Bob?

Det låsta `workflow_construction_drawing` innehåller 19 verktyg och instruerar Bob
att läsa aktuell konstruktion, spara en sammanhängande revision, kontrollera den
och därefter rita. Det innehåller `change_construction_parameters`, men inte
`plan_cad_pieces` eller `compose_cad_shell`. `describe_tool` för ett arbetsflöde
laddar alla dess tillgängliga medlemmar. I körningen valdes arbetsflödet i modellanrop 4.

**Viktig precisering:** delningsverktyget är inte borttaget eller generellt dolt.
Den driftsatta `buildBobHands` listar även de individuella verktygskorten. Bob kan
beskriva delningsverktyget separat. Avsaknaden från arbetsflödet är därför en
vägledningslucka, inte bevis för otillgänglighet eller ensam förklaring till körningen.
Påståendet att Bob enbart ser arbetsflödeskort är för grovt. Den låsta katalogen har
sju arbetsflöden; använd inte planens ursprungliga antal som uppmätt fakta.

Ingen `plan_cad_pieces`, `change_construction_parameters`, `derive_construction_lists`
eller `design_project_cad` begärdes i den granskade körningen. Att lägga till
delningsverktyget i arbetsflödet räcker inte: dess krav på färdiga konstruktioner
skulle fortfarande lämna arbetet före överlämningen hos Bob.

## 3. Den faktiska ändringen var liten i förhållande till dokumentet

Revision 6 jämfördes med kvitterad revision 7 per stabilt ID/bindningssökväg:

| Innehåll | Revision 6 | Revision 7 | Verifierad skillnad |
| --- | ---: | ---: | --- |
| Deldefinitioner | 11 | 12 | En ny definition för förenklad lådvolym |
| Placerade delar | 25 | 28 | Tre nya lådvolymer |
| Parameternoder | 42 | 50 | Åtta nya noder |
| Bindningar | 183 | 204 | 21 nya bindningar |
| Materialposter | 11 | 12 | En ny post |
| Fogar | 36 | 36 | Alla befintliga fogposter oförändrade |

Alla tidigare poster inom dessa sex jämförda samlingar var oförändrade. Det betyder
inte att varje metadatafält eller öppen fråga var oförändrad, och lådvolymerna är
inte färdig detaljkonstruktion av lådor, beslag eller hållfasthet.

**Parameterkommandot hade inte räckt:** nya delar, noder och bindningar ligger
utanför dess tillåtna ändringar. Nuvarande manual hänvisar just sådant till
`save_construction_draft`. Körningen visar därför inte att Bob ignorerade ett redan
fullgott smalt kommando för denna ändring.

## 4. Fullständig omskrivning skapade två verifierbara problem

| Modellanrop | Funktionsargument, kompakt JSON | Kontroll |
| --- | ---: | --- |
| 21 | 41 022 tecken | Obligatorisk `change_note` saknas; avvisas av runtime-schemat före skrivning. En befintlig fog har dessutom samma del i båda ändar. |
| 22 | 41 176 tecken | Endast `change_note` och skrivnyckeln skiljer från föregående förslag. Den felaktiga fogen finns kvar. |
| 25 | 41 116 tecken | Fogen är återställd till två korrekta tidigare ändpunkter. Detta förslags nyckel matchar skrivkvittot för revision 7. Även lådornas ID-/parameter-/rollinnehåll ändrades mellan förslagen. |

Teckenmåttet här är kompakt JSON. Den tidigare auditens 43 918 / 44 074 / 44 024
avser PostgreSQL:s normaliserade JSONB-text med annan formatering; det är samma anrop.

Den skadade fogen kopplade `upper_back_batten` till sig själv i stället för
`upper_back_rail`. Installerad `bob_private.check_construction` avvisar sådana
självkopplingar med `invalid_joint`/`22023`. Förslag 22 är därför ogiltigt enligt
den installerade kontrollen. Eftersom originalsvaret saknas går det **inte** att
bevisa att just detta var det första fel som databasen rapporterade då.

JSON-schemat, geometri-/parameterparsern, rollkontrollen och källfri parameter-
kompilering upptäcker inte självkopplingen. Den återstående databaskontrollen
är nödvändig. `project-write.ts` omvandlar ett sådant konstruktionsfel till ett
generiskt besked om att databasen avvisat kommandot, utan fog-ID eller felorsak.
Det gör korrigeringen mindre riktad än den behöver vara.

Kvitto finns bara för anrop 25:s konstruktion. Detta är tre sparförslag, inte tre
sparade revisioner, och ingen dubbelskrivning har belagts.

## 5. Upprepningar och kostnad: vad är belagt?

Före första sparförslaget kom 20 huvudanrop. Samma läsning av konstruktionens
aktuella revision begärdes i anrop 8, 11, 14 och 17. Samma kontroll av revision 6
begärdes i 12, 15 och 18. Dessutom lästes exakt revision 6 i 5 och 20.
Detta är nya native modellbegäranden, inte bara återspelade verktygshändelser.

| Huvudmodellens arbete | Antal anrop | Bokförd kostnad |
| --- | ---: | ---: |
| Anrop 1–20, före första sparförslaget | 20 | $1.611574 |
| Tre fullständiga sparförslag, 21/22/25 | 3 | $1.311237 |
| Övriga senare anrop | 6 | $0.535645 |

Summering: huvudmodell $3.458448; med sammanfattningar och leveransspråk
$3.94513665. Sparförslagens kostnad omfattar hela respektive modellanrop, inklusive
input och resonemang, inte bara JSON-texten. Den är inte en beräknad besparing.

Sammanfattningar förekom tätt under läs-/kontrollvarven. Det stöder hypotesen att
förlorad detaljkontext bidrog, men bevisar inte varför modellen valde varje nytt
anrop. Aktuella källor och behörighet kan legitimt behöva kontrolleras igen.
Den slutliga tekniska stopporsaken `ai_operation_changed` är separat och har
behandlats i #284; den förklarar inte varför de tidigare 20 huvudanropen behövdes.

## 6. Verifiering och nästa avgränsade rättning

Offline-reproduktion med produktionsvalidatorer, utan RPC eller modellanrop:

```sh
node --no-wasm-code-gc --import tsx scripts/audit-bob-construction-trace.ts --calls /path/to/private-calls.json
```

Format: en lista med `{round,args}` där `args` endast är native
`save_construction_draft`-argument. Skriptet skriver ut formfel, antal självkopplade
fogar, storlekar och ändrade toppfält. Rå geometri eller privat manifest checkas inte in.
Källfri kompilering lyckades för alla tre, schemat avvisade första och självkoppling
fanns i de två första. Detta ersätter inte historiska RPC-svar eller källkontroller.

Fem befintliga riktade `cad-pieces`-tester passerade: separata köposter, ogiltiga
delar, krav på samtliga kontrollerade konstruktioner, partiella lagringsfel och
återupptagning efter köfel. De verifierar delkön, **inte** att modellen kan färdigställa
konstruktionerna billigt. Ingen ny betald körning, full CI eller deployment gjordes.

Minsta motiverade rättning är nu tydligare:

1. Tillåt avgränsade, versionsbundna ändringar av konstruktionsdelar och deras
   nödvändiga noder/bindningar/material/roller/fogar. Servern hämtar och bevarar
   resten. Återanvänd parameterkommandot när endast befintliga indata ändras.
2. Returnera små relevanta vyer och precisa valideringsfel med berörda ID:n.
   Ett saknat metadatafält eller felaktig fog ska inte kräva ny generering av
   41 000 tecken. Bevara kvitton, auktorisation och exakta källversioner.
3. Anpassa arbetsflödet till ändringens omfattning. Delkön är för naturliga
   delkonstruktioner; dela inte automatiskt en liten ändring i flera ritningsjobb.
   Återanslut kompakta repetitionsbeskrivningar först med samma kanoniska kontroller.
4. Testa offline på denna ändringsform: tre tillagda delar, alla tidigare poster
   oförändrade, precisa fel, exakt återförsök och fortsatt arbete efter avbrott.
   Modellens verkliga val, färdig ritning och kostnad kring $1 förblir öppna grindar.

Detta kompletterar [verktygs-/kontextauditen](bob-launchpad-migration-audit-2026-10-19.md#tool-payload-audit).
Att bara korta manualerna, lägga till delningsverktyget i ett kort eller koppla in en
mindre läsmodell löser inte den påvisade skrivluckan. Aktivering av #285/#286 väntar.
