# Arkiv — granskning och tidigare överlämning för Bobs leveransflöde

> **Historiskt underlag från 2026-09-29, inte aktuell State eller ett nytt verifieringsresultat.** Denna fil bevarar den daterade genomgången som tidigare låg i `Docs/bob-delivery-flow.md`, avsnitt 9, samt hänvisningen till tidigare överlämningsstatus. Arkivering innebär inte att fynden är lösta.
>
> **Fortsätt arbetet i [State](../bob-delivery-flow.md#state).** Målkontrakt, P0-plan och acceptansfall finns i [leveransflödets ägardokument](../bob-delivery-flow.md). Gällande runtimebeskrivningar hör till respektive domänägare och [funktionsinventeringen](../function-inventory.md).

## Kontrollens avgränsning och bevisstyrka

Kontrollen utgick från main [`cf320c661691d22101b121914ea69326d8cbc6f7`](https://github.com/EmelieHagander/Bob-the-builder/commit/cf320c661691d22101b121914ea69326d8cbc6f7). [PR #157](https://github.com/EmelieHagander/Bob-the-builder/pull/157) var mergad som `3d87a6b5de6b844ec7f55b155681a69ace164da2`. Sökningen efter öppna PR:er gav inga träffar före det ursprungliga dokumentationsutkastet. Det säger inget om opushat arbete eller senare ändringar.

Kod och ägardokument lästes mot denna commit. En separat **read-only** kontroll gjordes i det angivna Supabase-projektet; mät-/scope-resultatet hade databastid `2026-09-29 10:03:37.023034+00` (12:03 i Stockholm). Inga data, funktioner, inställningar eller migrationer ändrades av kontrollen.

**Inte omkört i den genomgången:** det tidigare isolerade regressionstestet, full Node/SQL-/browser-svit, betald modell/CAD-körning eller jämförelse av alla driftsatta Edge-filer. Kodvägsfynd är inte live-reproduktioner. Tidigare CI- och driftsättningsbevis hänvisades till [CAD-ägarens releasepost](../cad-adapter.md#drawing-intake-and-complements--september-29-contract); de var inte nya testresultat från genomgången. Denna arkivering tillför inga nya live- eller kodtester.

## Det som noterades som befintligt vid kontrollen

PR #157 innehöll strukturerat ritningsintag, genomgång av samtliga överlämnade krav plus extra behov, bounded/paginerad källhämtning, privata sparade ritningsuppdrag och separata renderverktyg för ny geometri respektive befintliga delar. Direkt bindning till vissa projektmått fanns. Oberoende granskning, godkännande av exakt kandidat och befintlig Artifact-sparväg fanns också. Slutsatsen var att komplettera denna grund, inte börja om med en annan databas.

Livekontrollen bekräftade att `bob_private.drawing_requests` och `drawing_request_writes` fanns med RLS aktiverat. Den kontrollen ensam bevisade inte normalanvändarens alla rättigheter eller fullständig återupptagning efter en ändring i UI.

<a id="fynd"></a>
## Daterade fynd F1–F4

| ID | Kontrollresultat vid angiven tidpunkt | Betydelse och bevisgräns |
|---|---|---|
| F1 | **Bekräftat i data vid kontrollen:** `p_barnrum_vaningssang` hade 30 måttposter, alla 30 aktiva; 0 rader i `project_physical_scope` och 0 i `area_physical_targets`. Fyra aktiva ämnesetiketter innehöll V1 och fyra V2. Alla 30 saknade component-koppling. | Fysisk projektscope saknades i dessa kanoniska relationer. V1/V2 är etiketter, inte bevis för att alla åtta motsäger varandra. Faktisk semantisk ersättning och rätt byggnad/rum måste fastställas före datarättning. Avsaknad av koppling bevisar inte att byggnaden/rummet saknas globalt. |
| F2 | **Bekräftat i granskad main:** `bindMeasuredDimensions` tillät tom bindningslista och stödde ett begränsat antal dimensionsfält på definitioner, med ID/revision från projektets `measurements`. | Exakt hämtning fanns när bindningen användes, men inte ett heltäckande kontrakt för fysisk källidentitet, instansplaceringar, koordinattransformationer och beräkningskedjor. Ett fält som finns är inte bevis på full täckning. |
| F3 | **Kodvägen bekräftad, tidigare regression inte omkörd:** granskningsinsamlingen märkte läsfel/avkortning som `incomplete_datasets`. Oberoende evidens skickades till modellen, men accepteringsgrenen kontrollerade inte detta fält maskinellt innan `pass` gav `ready` och en tillgänglig kandidat. | Prompten varnade, men var inte en hård grind. Det tidigare beskrivna felet var fortfarande möjligt i den lästa kodvägen. Detta bevisar inte att en felaktig liveleverans faktiskt sparats. |
| F4 | **Bekräftat i granskad main och live-schemaform:** applicerade bindningar returnerades i renderverktygets resultat, men fanns inte i `CadCandidate` eller dess sparade draft. `artifact_cad_revisions` lagrade recept/exportdata och vissa identiteter; `artifact_measurements` höll mått-ID/revision men ingen koppling per parameter. | Spårning på postnivå fanns. En komplett kedja parameter → källa/beräkning/placering → granskningsbevis bevarades inte via den granskade CAD-vägen. Andra Artifact-typer kan ha egna geometriunderlag; de är inte bevis för att detta CAD-kontrakt är komplett. |

**Kodbevis, låsta till granskad commit:** [intag och bindningar](https://github.com/EmelieHagander/Bob-the-builder/blob/cf320c661691d22101b121914ea69326d8cbc6f7/supabase/functions/_shared/cad-intake.ts), [oberoende granskningshämtning](https://github.com/EmelieHagander/Bob-the-builder/blob/cf320c661691d22101b121914ea69326d8cbc6f7/supabase/functions/_shared/drawing-review.ts), [godkännande och kandidatskapande](https://github.com/EmelieHagander/Bob-the-builder/blob/cf320c661691d22101b121914ea69326d8cbc6f7/supabase/functions/_shared/cad-assistant.ts#L160-L307), [granskningsparser och fingeravtryck](https://github.com/EmelieHagander/Bob-the-builder/blob/cf320c661691d22101b121914ea69326d8cbc6f7/supabase/functions/_shared/cad-review.ts).

<a id="livscykel"></a>
## Livscykelavgränsning

Ritningsuppdragen var vid kontrollen privata och trådbundna. CAD-kontraktet angav återupptagning genom nästa turns `request_id` och att chattreset raderade arbetsläget via FK. Det var inte samma sak som den föreslagna projektbeständiga, händelsestyrda fortsättningen. Automatisk väckning av ett vilande ritningsuppdrag efter enbart ett UI-mått eller en Task-uppdatering var **inte verifierad i genomgången**.

## Reproducerbar read-only datakontroll

Kör bara inom behörig felsökning. För annat projekt ska ID:t ersättas uttryckligt; ingen global datarättning eller automatisk arkivering följer av resultatet. En ny körning ska redovisas med eget datum och egna resultat.

```sql
select now() as checked_at,
  (select count(*) from bob.project_physical_scope
   where project_id='p_barnrum_vaningssang') as project_physical_links,
  (select count(*) from bob.area_physical_targets
   where project_id='p_barnrum_vaningssang') as area_physical_links,
  count(*) as total,
  count(*) filter (where not archived) as active,
  count(*) filter (where not archived and subject ilike '%v1%') as active_v1_subject,
  count(*) filter (where not archived and subject ilike '%v2%') as active_v2_subject,
  count(*) filter (where not archived and component_id is null) as active_without_component
from bob.current_measurements
where project_id='p_barnrum_vaningssang';
```

För schemaformen lästes `information_schema.columns` för `bob.artifact_cad_revisions`, `bob.artifact_measurements`, `bob.measurement_revisions`, `bob.current_measurements` och de två scope-tabellerna. RLS kontrollerades med `pg_class.relrowsecurity` för de två privata request-tabellerna. Endast aggregat/schema redovisades, inga måttvärden, bilder eller privata chattinnehåll.

## Tidigare dokumentationsarbete och ersatt State

Den ursprungliga modellen och indexlänkarna checkades in i [4f82c4d](https://github.com/EmelieHagander/Bob-the-builder/commit/4f82c4d769c4cc7105a127053bd727fa16d4ba21). P0:s arbetsordning och den första utförliga State-sektionen tillkom i [2f29037d](https://github.com/EmelieHagander/Bob-the-builder/commit/2f29037ddc49fdd705b5e32ce3fdf3da88be0bed). [Den tidigare State-texten finns bevarad på exakt commit](https://github.com/EmelieHagander/Bob-the-builder/blob/2f29037ddc49fdd705b5e32ce3fdf3da88be0bed/Docs/bob-delivery-flow.md#state); den är historik, inte instruktionen att börja om från.

Vid den hållpunkten låg dokumentationsarbetet i utkast-PR #158, main hade återkontrollerats till `cf320c6` och P0.1–P0.4 samt P1–P4 återstod. Ingen P0-implementation, datarättning, migration, merge eller driftsättning ingick. Archies definition och stödmaterial hade lästs av den arbetande assistenten; ingen separat Archie-körning eller oberoende subagentgranskning påstods.

Den aktiva State-sektionen ersätter denna avslutsorienterade hållpunkt med nästa handling, kvarstående arbete och öppna acceptanskrav. Avslutade kontroller behåller sina bevisgränser här. Gällande designval och ännu öppna åtgärder ligger kvar i sina aktiva ägardokument.
