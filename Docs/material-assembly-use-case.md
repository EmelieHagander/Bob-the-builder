# BOB-UC-MATERIAL-ASSEMBLY-01 — Material till ritning, plockning och inköp

**Status:** specificerat användningsfall; föreslagen logisk datamodell, inte implementerad funktion eller körbar migration.  
**Datum:** 2026-09-21.  
**Beställning:** dokumentera det överenskomna materialbaserade flödet och dess databasrelationer innan implementation. Bob gör modelleringen; användaren beskriver, rättar och fattar projektbeslut.  
**Kontrollerad kodbas:** `a31c537d92e8e642728aceb441785e3e2b4eaa8e` på `main`. Ingen produktionsdatabas har undersökts eller ändrats för detta dokument.

Detta är den sammanhängande framgångs-/felvägen och acceptansgrunden för materialdrivna sammanställningar. Tabell- och verktygsnamn märkta **nya** är förslag som ska valideras mot implementationen, inte befintliga API:er. Dokumentet preciserar den generella nästa ritförmågan; det gör inte befintliga specialgeneratorer generella genom en namnändring.

**Aktuell genomförandeplan:** [teknisk kedja, verktyg och modellprov](#assembly-chain-plan), beslutad som planeringsriktning den 2 oktober 2026. Den bygger vidare på A–D nedan; aktuell nästa handling och öppna grindar finns i [State](bob-delivery-flow.md#state). Ursprunglig datamodell ovan är fortfarande ett förslag; senare domänägare beskriver vad som faktiskt finns.

## 1. Ägarskap och mål

Användarmålen ägs fortsatt av [user-stories.md](user-stories.md), särskilt BOB-US-010 och BOB-US-018–026. Befintlig ritningsidentitet/historik ägs av [artifacts.md](artifacts.md), behov/lager/Shopping av [material-planning.md](material-planning.md), platsmodellen av [building-model.md](building-model.md), verktygsåtkomst av [ask-bob-tools.md](ask-bob-tools.md) och implementerad databas/behörighet av [db/README.md](../db/README.md). Här ägs den nya tvärgående usecase-kedjan och dess föreslagna relationer, inte en konkurrerande lager- eller inköpsmodell.

### Användarberättelse

> Som projektägare vill jag beskriva det vi ska bygga och material vi vill använda. Bob ska hitta och återanvända passande material/delar, skapa saknade definitioner, sätta ihop konstruktionen och ge mig konsekventa ritningar, del-/kaplistor, plockförslag och inköpsförslag. En ändring ska gå att följa genom samma underlag, utan att jag skriver JSON eller modellerar delarna själv.

**Produktregel:** olika föremål är olika innehåll i samma verktyg — inte nya `bed_v1`, `shelf_v1` eller materialspecifika verktyg. En katalogträff får återanvändas när den passar; frånvaro i katalogen får inte förbjuda en ny konstruktion. Däremot är en saknad geometrisk operation, okänd avgörande egenskap eller saknad behörighet ett verkligt och tydligt redovisat hinder.

Shopping ska visa **mängd + inköpsenhet | material/artikel | relevant specifikation | valfri produktlänk**. Specifikationen varierar: en skiva har andra egenskaper än ett rör eller en färgburk. Klick på raden ska visa vilka behov och ritningsdelar den täcker.

## 2. Aktörer, startvillkor och slutresultat

**Aktörer:** projektägare, Bob, deltagare som plockar/bygger och personen som köper material. Systemet kontrollerar behörigheter och beräknar resultat; modellen väljer och förklarar arbetsförslag.

**Start:** ett explicit aktivt projekt och aktuell användarbehörighet. Bibliotekssökning och konceptarbete får föregå ett valt projektmål. Sparande av projektets ritning/materialbehov följer däremot den befintliga gränsen för vald target/solution-version. Saknas den ska Bob peka på den faktiska nästa projektåtgärden, inte hitta på ett target-ID eller begära att användaren fyller i ritnings-JSON.

**Lyckat slut:** en versionslåst sammanställning går att återöppna som plan, elevation och relevanta snitt; delbeteckningar och beräknade mått stämmer med dellistan. Materialbehov refererar till samma version. Lagerförslag, kapplan, plocklista och inköp visar varifrån siffrorna kommer och vad som ännu är oklart. Shopping uppdateras när användaren bett om det; en ritningsändring är inte en order, en lagerförflyttning eller ett utfört byggmoment.

## 3. Huvudflöde — Bob gör arbetet

| Steg | Användaren/Bob | Systemets resultat |
|---|---|---|
| 1 | Användaren ber om konstruktion, ritning och listor i vanlig text. | Bob läser aktuella mått, mål, tidigare delar och relevanta bilder vid behov; källor och motstridiga uppgifter bevaras. |
| 2 | Bob behöver material-/ritverktyg som inte är förladdade. | `list_tools` ger tillåtna namn och beskrivningar; `load_tool` gör exakt schema och vägledning tillgängliga och verktyget anropbart i nästa modellsteg. |
| 3 | Bob söker exempelvis material=trä, form=skiva, tjocklek=18 mm. | Sökningen skiljer exakta matchningar, möjliga alternativ, fler sidor och tekniskt fel. Privat otillgängligt innehåll röjs inte. |
| 4 | En passande materialdefinition finns. En deldefinition saknas. | Befintligt material-ID/version återanvänds. Bob skapar en tillåten privat deldefinition med parameterstyrd geometri. |
| 5 | Bob väljer material, delantal, lägen och samband inom uppdraget. | En gemensam sammanställning beskriver delinstanser, relationer, bearbetningar och uttryckligt tillbehörsbehov. |
| 6 | Bob validerar och sparar. | Servern beräknar och kontrollerar modellen; giltigt koncept får versionskvitto. Olösta/ogiltiga beräkningar redovisas utan falsk komplett kap-/inköpslista. |
| 7 | Användaren läser ritning och dellista i Bob. | Samma modell ger vyer, mått och delbeteckningar. Val i en vy markerar motsvarande exemplar i den andra. |
| 8 | Bob jämför behov med bekräftat användbart lager/återbruk. | Förslag skiljs från verklig reservation. Dimensioner, skick och redan reserverad kapacitet kontrolleras. |
| 9 | Bob tar fram kap- och inköpsförslag. | Råmaterialets format, sågspår och riktning kontrolleras; kompatibla behov sammanförs innan förpackningsavrundning. Ej löst råmaterialuttag märks olöst. |
| 10 | Användaren ber att lägga in/uppdatera Shopping. | Samma Shopping-yta uppdateras med strukturerad specifikation och länkar. Befintlig beställningsstatus och manuella inköpsuppgifter skyddas. |
| 11 | Användaren ändrar ett mått eller material. | Bob reviderar samma konstruktion, visar påverkade delar och nya listförslag. Gamla versioner, plockhändelser och redan beställda varor skrivs inte om. |

Att skapa nödvändiga privata definitioner ingår i en tydlig konstruktionsbeställning när rätt skrivbehörighet finns. Det kräver inte ett extra godkännande per bräda. Det ger inte rätt att publicera i ett gemensamt bibliotek, påstå att något finns i lager eller genomföra inköp.

## 4. Databasens grundprincip

**Relationella identiteter och länkar + versionsstyrda, validerade egenskaper i JSONB.** Inte en universell `length/width/thickness`-tabell, inte en tabell per material och inte ett enda fritt JSON-dokument för hela projektet.

Identiteter, projektägarskap, revisioner, källrelationer, antal/enheter och reservationer ska vara vanliga kolumner och relationer. Dynamiska materialspecifikationer, parameteruttryck och geometrirecept kan ligga i avgränsade JSONB-fält med exakt kontraktsversion. JSON-formatets giltighet ersätter inte kontroll av egenskapers betydelse, enheter eller relationer.

```text
kategorier + egenskapsdefinitioner + versionsstyrd specifikationsprofil
                            |
                     materialdefinition@revision
                            |
                     deldefinition@revision
                            |
                delinstanser i Artifact@revision
                       /                 \
                ritningsvyer       behovskällor per exemplar
                                         |
                            MaterialRequirement@revision
                              /          |           \
                   lager/återbruk     plockförslag    inköpsförslag
                                                         |
                        många-till-många-fördelning till Shopping-rader
                                                         |
                           valfri produktvariant@revision + produktlänk
```

`@revision` betyder en faktisk referens till just den versionen, inte att varje läsning följer objektets senaste version. När många behov sammanförs måste varje bidrag fortfarande vara spårbart.

### 4.1 Föreslagna tabellgrupper

Samtliga nya Bob-ägda tabeller föreslås i schemat `bob`, inte `public` eller andra appars scheman. Interna privilegierade hjälpare följer befintlig `bob_private`-gräns. Tabellgrupperna nedan är logisk design, inte ett krav på att bygga alla tabeller i första migrationen.

| Grupp | Ansvar och nyckelrelationer | Status |
|---|---|---|
| `catalog_categories` | Stabil kod, axel (`material`, `form`, `function`), namn, alias och parent inom samma axel. Trä och plast/PVC hålls isär från skiva och rör. Cykler tillåts inte. | Ny |
| `property_definitions` | Stabil egenskapsnyckel, betydelse, värdetyp och fysisk dimension. Semantisk ändring kräver ny nyckel/version; ytterdiameter får inte senare betyda innerdiameter. | Ny |
| `spec_profiles`, `spec_profile_revisions`, `spec_profile_fields` | Exakt profilversion och relationer till egenskapsdefinitioner; tillåtna enheter, krav per användning, enkel validering och visningsordning. Ändrade krav skriver inte om gamla profiler. | Nya |
| `catalog_materials`, `catalog_material_revisions` | Återanvändbar materialspecifikation. Identitet, ägarskap, revision, profil-ID/version, klassificering, validerade `properties` och källstatus. Ingen lagerkvantitet här. Klassificeringslänkar till kategori-ID:n är relationella. | Nya |
| `part_definitions`, `part_definition_revisions` | Tillverkad eller köpt del: material-ID/version där relevant, parametrar, lokalt geometrirecept, namngivna anslutningspunkter och bearbetningar. Ingen global plats eller lagerkvantitet i definitionen. | Nya |
| `artifact_assemblies`, `artifact_part_instances`, `artifact_relations` | Tillägg till befintlig `(artifact_id, revision)`. Sammanställningsparametrar, stabila exemplar-ID:n, exakta delrevisioner, parameterbindningar, läge/riktning och samband. Ingen parallell ritningsidentitet. | Nya tillägg till Artifact |
| `artifact_subassemblies` och placerings-/källbindningar | Exakt under-Artifact/version och dess instans/transform. Bindningar till befintliga mått och Building/Space/Element-revisioner återanvänder deras auktoritetsgräns. | Nya relationer, befintliga källor |
| `material_requirement_sources` | Kopplar befintlig behovsversion till exakta ritningsversioner och delinstanser/underinstansvägar. Bevarar bidrag och beräkningsgrund utan en andra materialbehovssumma. | Ny relation till befintligt behov |
| `stock_material_specs` | Versionsbundet katalog-/profil-/format-tillägg till befintlig `stock_items`/`stock_revisions`. Antal, skick och reservationer fortsätter ägas där. Diskreta brädor/skivor måste kunna särskiljas när kaputtag kräver det. | Nytt tillägg, inte nytt lager |
| `cut_plans`, `cut_plan_revisions`, `cut_plan_allocations` | Förklarar vilka instanser som fås ur vilka lagerbitar eller föreslagna inköpsämnen, med format, sågspår, riktning och rester. Kopplas till samma behov/reservationer. | Nya, stegvis |
| `catalog_products`, `catalog_product_revisions` | Konkret leverantör/artikel/variant med katalogkoppling, leveransformat, inköpsenhet, förpackningsinnehåll, källtid och valfri URL. Separat från generiskt material och från lager. | Nya, valfri produktbindning |
| `shopping_line_revisions`, `shopping_line_allocations` | Strukturerat versionstillägg till befintliga `bob.materials`-rader: antal inköpsenheter, specifikation, katalog-/produktreferenser och fördelning mot exakta behovsversioner. | Nya tillägg; befintlig Shopping består |
| `pick_lists`, `pick_list_revisions`, `pick_list_lines`, `pick_events` | Versionsbundna plockförslag för kapning/montering samt separata faktiska plockhändelser. Linjer refererar till delar/lager/produkter med riktiga, validerade länkar. | Nya; inte automatiskt förbrukningslager |

Materialbiblioteket kan kallas **bob_materials** i samtal, men `bob.materials` är redan Shopping-tabellen. Förslaget använder därför `bob.catalog_materials` för definitionerna. Vi ska inte byta betydelse på befintliga shoppingposter.

### 4.2 Relationer som måste skyddas

Identitet/version kopplas med sammansatta främmande nycklar, exempelvis `(material_id, material_revision)` till materialrevisionen och `(artifact_id, artifact_revision, instance_id)` till en ritningsinstans. Där projekt är en del av gränsen ingår det i relationen eller valideras vid samma atomiska skrivning; ett giltigt UUID är inte bevis på projektåtkomst.

Ägarskap och förbruknings-/inköpsrelationer får inte gömmas som godtyckliga UUID-strängar i JSON. Ett JSON-recept får referera till lokala parametrar/ankare, men kommando och beroendeindex måste kontrollera att referenserna finns i rätt versionslåsta modell. Underassemblies bildar en acyklisk struktur. Samma underassembly får förekomma flera gånger med separata instans-ID:n.

Ett placerat exemplar har en identitet genom revisionerna. Antal i en sammanställning räknas från instanser eller uttryckliga repetitionsinstanser, inte från både en antalskolumn och motsvarande barnrader. Ritade referensobjekt, exempelvis en madrass eller vägg, har en roll som utesluter dem ur inköpsbehovet när de endast är passningsunderlag. Inköpsbara underassemblies och deras barn får inte båda räknas som inköp av samma innehåll.

## 5. Dynamisk specifikation — konkret representation

Material, form och funktion är olika sökaxlar. PVC är ett material, inte ett synonymt namn för rör. Nya klassificeringar och specifikationsprofiler ska kunna tillkomma som validerade data utan nya shoppingkolumner eller nya verktyg per kategori.

### Profilexempel: rör

Detta är ett illustrativt profilpaket som Bob kan läsa vid behov. Symboliska koder används här; produktionsrelationerna använder hämtade identiteter och revisioner.

```json
{
  "profile_code": "tube",
  "profile_revision": 1,
  "fields": [
    {"key": "outside_diameter", "value_type": "quantity", "dimension": "length", "canonical_unit": "mm"},
    {"key": "wall_thickness", "value_type": "quantity", "dimension": "length", "canonical_unit": "mm"},
    {"key": "length", "value_type": "quantity", "dimension": "length", "canonical_unit": "mm"}
  ],
  "required_for_geometry": ["outside_diameter", "wall_thickness", "length"],
  "display_order": ["outside_diameter", "wall_thickness", "length"]
}
```

Exempel på egenskapsvärden i en del eller råmaterialvariant som använder profilen:

```json
{
  "outside_diameter": {"value": 32, "unit": "mm", "truth": "provided_spec"},
  "wall_thickness": {"value": 2, "unit": "mm", "truth": "provided_spec"},
  "length": {"value": 2000, "unit": "mm", "truth": "provided_spec"}
}
```

Värdena är testdata/designspecifikation, inte ett påstående om en tillgänglig eller lämplig VVS-produkt. Nominell rörbeteckning, anslutning, tryck-/temperaturklass och faktisk diameter är separata egenskaper och får inte gissas från varandra.

**Lagring:** profilreferensen och versionen ligger i relationskolumner. `properties` lagrar värdena. Källhänvisningar till ett mått, användarmeddelande eller kontrollerad produktuppgift lagras i versionsbundna källrelationer; en URL/textetikett ensam är inte verifierad proveniens.

**Validering:** tillåtna nycklar, värdetyper, enhetsdimension, ändliga numeriska värden, rimliga systemgränser och profilens uttryckliga samband kontrolleras på servern. Exempelvis är rörgodsets relation till ytterdiametern en geometrisk kontroll, inte en tryckklassning. Profilregler använder en begränsad deklarativ regelmängd, inte modellskriven SQL/JavaScript.

**Okänt:** en uttryckligt okänd uppgift representeras med `value: null`, `truth: unknown` och förklaring. Det är varken noll, matchande vad som helst eller ett uppmätt värde. Ett utelämnat valfritt fält betyder inte att dess värde är bevisat irrelevant. Kraven får vara olika för att registrera en preliminär definition, rita geometri och välja en kompatibel produkt. Inkompletta poster får inte skapa falskt färdiga beräkningar.

**Visning:** blandade shoppingrader använder en kort specifikationsruta. En filtrerad skivvy kan visa längd/bredd/tjocklek som kolumner; rörvyn visar i stället diameter/gods/längd. Fältordning kommer från profilen, inte från JSON-nycklarnas lagringsordning. Antal och inköpsenhet visas alltid separat från dimensionerna.

## 6. Hitta, återanvänd eller skapa — utan dubbletter

Sök med kategorier, namn/alias och typade egenskapsfilter. Normalisera enheter vid jämförelse: 18 mm och 1,8 cm kan representera samma tjocklek. Tvärsnitt, behandling, kvalitet, riktning och andra krav får däremot inte ignoreras för att namnet liknar en annan post. Toleranser/substitutioner är uttryckliga beslut, inte en fuzzy-match som automatiskt ändrar material.

Bob söker först och följer relevanta sidor. Exakt uppslag ska finnas vid känt ID. Tekniskt fel, indragen rättighet och en tom filtrerad sida får aldrig behandlas som bevis för att en definition saknas.

Ett kommande **ensure/find-or-create-kommando** ska vid den slutliga sparningen göra en atomisk identitetskontroll inom tillåtet ägarskap. En serverberäknad normaliserad identitetsnyckel, exakt jämförelse och idempotensnyckel skyddar mot dubbletter och samtidiga anrop. Nyckeln omfattar identitetsbärande specifikation och kontraktsversion, inte bara titel. Semantiskt olika specifikationer eller olika kritiska okända egenskaper får inte slås ihop som likvärdiga.

Ändrad kaplängd skapar inte en ny materialtyp. Materialets tvärsnitt/tjocklek och delens längd är olika roller. En parametrisk deldefinition kan instansieras med flera längder. En ändrad profilversion eller källuppgift gör inte gamla ritningar dynamiska; ny adoption kräver ny ritningsversion. Ett utkast/projektval får inte återanvändas som verifierad tillverkaruppgift.

Grundbehörigheten för första genomförandet bör vara granskad gemensam katalog + projektspecifika tillägg. Hushållsdelning av katalogposter är ett separat tydligt behörighetssteg mot befintliga hushåll, inte en ny familjedatabas eller ett automatiskt globalt bibliotek. Bob får skapa inom tillåtet projekt; inte ändra gemensamma definitioner eller läsa ett annat projekts material för att en liknande post råkar finnas där.

## 7. Geometri, mått och listor från en modell

En deldefinition beskriver lokal geometri. Instansen ger läge och riktning; platsen i huset är en separat versionsbunden placering. Plan/elevation/snitt härleds ur samma modell. Flytt i rummet ändrar inte kaplängden, om inte konstruktionen uttryckligen har en parameter kopplad till exempelvis väggöppningen.

Geometri bör uttryckas med återanvändbara profiler/konturer, linjer/bågar, extrusioner, hål/urtag, transforms och namngivna ankare. Första implementationen ska deklarera exakt vilka operationer den stöder. Ett nytt objekt av befintliga operationer kräver ingen kodändring; en verkligt ny geometrisk operation kan göra det. Inget löfte om obegränsad CAD eller full konstruktionsdimensionering.

Parameteruttryck använder en begränsad typad uttrycksmodell, inte eval eller körbar modellkod. Beroenden kontrolleras för cykler, fel enhetsdimension, saknade variabler och motsägande låsningar. Första motorn kan använda riktade, explicita beroenden snarare än lova en generell ekvationslösare. Måttetiketter ska komma från beräknad geometri; modellen får inte ge linjen och dess måtttext olika värden.

### Liten syntetisk acceptansfixtur

Detta är ett geometriprov, inte ett rekommenderat byggutförande:

- Modulens ytterbredd hålls vid 1 000 mm.
- Två sidstycken är 600 × 360 × 18 mm.
- Två hyllplan sitter mellan sidorna: `shelf_length = outer_width - 2 * side_thickness`, alltså 964 × 360 × 18 mm.
- Fyra delinstanser refererar till återanvändbara definitioner. Stöd, infästning och belastning antas inte verifierade av geometrin.

Byte av allt skivmaterial till 21 mm ger samma fyra instanser och ytterbredd men hyllängden **958 mm**. Katalogens 18 mm-definition och den gamla ritningen ska vara kvar; en 21 mm-definition återanvänds eller skapas separat.

För ett uttryckligt råskiveprov används en testskiva på 2 400 × 1 200 mm, 10 mm kanttrim och 3 mm mellan delarna. En möjlig kapplacering i skivans lokala x/y-system är två hyllplan vid (10,10) respektive (977,10), och sidstyckena vid (10,373) respektive (613,373), med respektive längd längs x. Alla fyra ryms i den användbara ytan och håller det angivna mellanrummet. Detta är en kontrollerbar kandidat, inte ett löfte om en generell optimal kapalgoritm.

**Del-/kaplistan visar fyra delar. Råmaterialinköpet kan visa en skiva först när den versionsbundna kapplaceringen är verifierad.** Inför kapning plockas råskivan; inför montering plockas de fyra färdiga delarna. Dessa är olika plockmoment, inte dubbla inköpsbehov.

## 8. Materialbehov, förpackningar och många-till-många

### Återanvänd befintliga behov och lager

`bob.material_requirements` och `material_requirement_revisions` förblir ägare för behov. Den nya beräkningsvägen behöver även katalog-/profilreferenser och källrelationer på exemplarnivå. Ursprunglig `source_kind = deterministic` får bara sättas av en reproducerad beräkning från exakt lagrade indata och metodversion; inte genom att modellen levererar en summa och kallar den beräknad.

Skruv, beslag, lim och ytbehandling kan vara explicita icke-geometriska behov. De ska referera till en del, relation eller arbetsgrund och ha en given/formelbaserad mängd. Avsaknad av geometrisk skruvmodell är inget skäl att tappa bort skruven; avsaknad av en infästningsregel är inget skäl att hitta på verifierat antal.

Lager finns redan i `stock_items`/`stock_revisions`. Definierat material är inte lager. En total sträcka eller area är inte bevis för ett möjligt uttag: två 1 000 mm-delar ryms inte automatiskt i en 2 000 mm-bräda när sågspåret kräver utrymme. Matchning behöver skick, dimensioner, tillåtna rotationer/fiberriktning och redan gjorda reservationer.

Diskreta uttag ska bindas till en faktisk lagerbit eller en identifierad enhet i ett likformat parti, så att samma skivyta inte reserveras flera gånger. Reservation och kapallokering måste samordnas atomiskt via samma lagerauktoritet. En föreslagen kaprest blir lager först efter en uttrycklig faktisk registrering, inte när ritningen skapas.

### Shoppingrelationen måste utvecklas

I den kontrollerade koden har `material_requirement_shopping` ett `requirement_id` som primärnyckel och ett unikt `material_id`. Nuvarande koppling är alltså en behovsidentitet till högst en Shopping-rad, och en Shopping-rad till högst ett sådant behov. Den räcker inte för generell samköpning eller delade leveranser.

Den nya versionsbundna relationen föreslås som:

```text
shopping_line_allocations
  shopping_material_id + shopping_revision
  requirement_id + requirement_revision
  allocation_quantity + allocation_unit
  optional cut_plan_id + cut_plan_revision
  project_id
```

Ett behov kan täckas av flera inköpsrader; en inköpsrad kan täcka flera behov. Varje fördelning behåller ursprung och kvantitet. Om råmaterial behöver kapas får en enkel area- eller längdproportion inte ersätta kopplingen till det faktiska kaputtaget. Överskott i ett paket dokumenteras som överskott, inte som ett påhittat extra behov.

**Förpackningsprov, oberoende av modulens infästning:** två kompatibla behov om 60 skruvar ger 120 st totalt. Bekräftat, disponibelt lager om 30 st ger 90 st att köpa. Med en känd packstorlek om 100 st blir inköpet **1 förpackning**, inte två separat avrundade paket. Lager får inte dras av två gånger.

Den strukturerade inköpsraden innehåller exempelvis `purchase_count = 1`, `purchase_unit = pack`, `content_per_purchase_unit = 100`, `content_unit = pcs`. `pack` är en inköpsenhet, inte en längdenhet och inte en redan stödd basenhet i dagens behovstabell. Om packstorlek saknas är paketantalet **olöst**, inte noll eller en gissning. Generiskt behov får finnas utan produktlänk eller SKU.

Samma materialnamn räcker inte för sammanslagning: profil, dimensioner, avgörande egenskaper, vald produktvariant och övriga uttryckliga krav måste vara kompatibla. Antal meter omvandlas inte till antal stänger utan känt inköpsformat och genomförbart uttag.

### Kompatibilitet med dagens Shopping

Behåll `bob.materials.id`, manuella rader och nuvarande inköpsstatus. Nya strukturerade rader får en revisionspekare och normaliserade inköpsfält i ett tillägg; gammal `qty` blir en kompatibel presentation, inte sanningen för beräkning. Gamla fritextvärden får inte automatiskt tolkas till säkra kvantiteter.

Inför en versionsstyrd ny handoff för många-till-många. Den gamla en-till-en-tabellen får inte fortsätta vara en oberoende skrivande sanningskälla för samma strukturerade rad. Migreringsdesignen måste välja en kontrollerad adapter/kompatibilitetsvy och testa gamla klienter; en gammal uppdatering ska antingen översättas säkert eller tydligt begära uppdaterad klient. Befintliga beställningar och manuella inköpsuppgifter får aldrig nollställas för att beräkningen ändras.

## 9. Versioner, ändringar, plockning och säkerhet

En sammanställningsrevision och dess direkta instans-/relationsrader sparas atomiskt med exakta källrevisioner. Härledda listor får samma input-fingerprint och metodversion. Kan materialberäkningen inte slutföras i samma steg märks dess resultat väntande/olöst; UI får inte visa en ny ritning med en gammal lista som om båda vore aktuella.

**Rita om är inte beställa om.** En designändring ska ge skillnaden mellan tidigare och nytt behov, inte skriva över lagd order, levererat antal, redan kapade delar eller faktiskt plockat material. Ett plockförslag är härlett; en plockhändelse är registrerad verklighet med användare/tid/källa. Plockat betyder inte automatiskt förbrukat. Ändringar efter plockning ger avvikelse/åtgärdsförslag.

RLS och kommandogränser gäller definitioner, sökresultat, antal, exakta revisioner och relationskanter. Tillgång till en publik basdefinition ger inte tillgång till ett privat projekt som använder den. Tillgång till projekt A ger inte åtkomst till projekt B:s delar via ett känt ID. Globala katalogposter kan bara ändras/publiceras av behörig förvaltning; privata definitioner delar inget automatiskt.

Bevara befintlig caller-JWT-, revisions-, turn-/idempotens- och kvittomodell. Misslyckad/oklar skrivning ska kunna återläsas utan dubbletter. En katalogträff eller uppladdad bild är inte rätt att köpa, markera färdigt eller godkänna bärighet. Profilregler, ritningsrecept och beräkningsuttryck är data, inte körbar modellkod.

Inaktivering av en definition ska hindra nya normala val utan att radera historiken. Att läsa en gammal ritning använder dess sparade beroenden bara medan aktuell behörighet finns; historik är ingen väg förbi indragen åtkomst. Import/kopiering mellan privata kontexter kräver uttrycklig tillåten överföring och får inte läcka ursprungsprojektets privata metadata.

## 10. Verktygs- och gränssnittskontrakt

Registrera generella funktioner för material-/delsökning, exakt läsning inklusive profil, säker find-or-create, sammanställningsvalidering/sparande, listberäkning och uttrycklig Shopping-handoff i den befintliga verktygskatalogen. De slutliga API-namnen och schemana fastställs vid implementation. Kort namn/beskrivning är inte det fulla kontraktet; Bob laddar exakt verktyg vid behov och kan därefter läsa relevant profil.

Profilhantering får inte skapa ett separat verktyg för varje materialtyp. Schema + egenskapsdata gör samma verktyg användbart för en ny profil. Arbetets normala rund- och tidsbudget måste provas på hela kedjan; dokumentera batchning eller ärlig återupptagning om allt inte ryms. Att en handler finns betyder inte att modellen hinner eller väljer att använda den. Inget löfte om obevakat bakgrundsarbete.

Ritning, Material plan och Shopping förblir de befintliga huvudsakliga ytorna. Plockning kopplas till sammanställning/uppgift utan att likställa Area med ett fysiskt rum. Ritningsbeteckning ska gå att följa till del/material, och en shoppingrad till alla behov/instanser den täcker. En historisk rad öppnar historiskt underlag. Mobil 320/390 px ska visa mängd, material och läsbar specifikation utan horisontellt sidöverflöde; extra egenskaper kan fällas ut. Detaljerad UI-design ska följa [ui-index.md](ui-index.md), inte skapa en parallell designstandard här.

## 11. Acceptansmatris — bevis innan vi kallar kedjan klar

Alla fall nedan är **krav**, inte tester som redan finns eller har passerat.

| ID | Givet / när | Förväntat resultat |
|---|---|---|
| AC-01 | Samma material finns med annan titel eller ekvivalent enhet. | Samma tillåtna definition återanvänds efter strukturerad jämförelse; originalkällor bevaras. |
| AC-02 | Material/del saknas; två samtidiga auktoriserade creates eller samma retry sker. | Högst en avsedd definition skapas per identitet/scope; idempotent kvitto. |
| AC-03 | Titelmatch finns men avgörande egenskap skiljer eller är okänd. | Ingen falsk likvärdighet; alternativ/okänt redovisas. |
| AC-04 | Tom filtrerad första sida, fler sidor eller sökfel. | Bob kan bläddra/bredda/exakt läsa; fel blir inte frånvaro och orsakar inte dubblett. |
| AC-05 | Material PVC förekommer som både skiva och rör. | Materialfilter hittar båda; form/profil ger korrekta egenskaper utan nya verktyg. |
| AC-06 | En behörig ny profil/egenskap tillkommer inom stödda värdetyper. | Samma sök-, läs-, spar- och Shopping-kod fungerar utan tabellkolumn eller objektspecifik generator. |
| AC-07 | Saknad enhet, fel typ, NaN, negativ storlek, okänd nyckel eller orimlig regel. | Servervalidering ger specifikt fel; aldrig nollutfyllnad eller kodexekvering. |
| AC-08 | Modulfixturen byter 18 till 21 mm med ytterbredd 1 000 mm låst. | Två hyllplan ändras 964 → 958 mm; fyra instanser kvar; gamla revisionen oförändrad. |
| AC-09 | Modulen flyttas i rummet, eller samma underassembly används två gånger. | Flytt ändrar bara placering; upprepning räknar varje lövinstans en gång per förekomst. |
| AC-10 | Cykel, oförenliga låsta mått eller saknad geometrisk operation. | Ingen fabricerad lösning; koncept/olöst status och konkret fel utan falskt komplett kapunderlag. |
| AC-11 | En redan befintlig madrass/vägg är passningsreferens. | Syns som referens men hamnar inte automatiskt som nytt inköp. |
| AC-12 | Fyra paneler i den angivna testskivan med trim/sågspår/riktning. | Kapkontrollen verifierar placeringen; dellistan har fyra paneler, råmaterialbehovet en skiva. |
| AC-13 | Total längd/area räcker men en nödvändig sammanhängande del inte ryms. | Ingen falsk lager-/inköpstäckning; fel uttag redovisas. |
| AC-14 | Skruvprovet 60 + 60 st, disponibelt lager 30 st, packstorlek 100 st. | Ett paket; spårning till båda behoven; stock/surplus inte dubbelräknat. |
| AC-15 | Packstorlek eller leveransformat saknas. | Nettobehov visas, antal paket/ämnen förblir olöst; ingen påhittad artikel eller URL. |
| AC-16 | Ett behov delas på två leveranser och en annan rad täcker två behov. | Många-till-många-bidrag och exakta revisioner går att återläsa utan dubbletter. |
| AC-17 | Två kapplaner försöker reservera samma lagerbit eller skivyta. | Atomisk kapacitets-/överlappskontroll; högst en oförenlig reservation lyckas. |
| AC-18 | Geometrisk ändring efter publicerad Shopping/plockning/beställning. | Nya förslag/diff och stale-markering; registrerad verklighet, status och äldre underlag bevaras. |
| AC-19 | Gemensam katalogdefinition, produktuppgift eller måttkälla uppdateras. | Existerande ritning/lista ändras inte i smyg; ny adoption ger ny version. |
| AC-20 | Outsider, annan projektmedlem, gäst eller indragen rättighet använder kända ID:n. | Verkliga SQL/RLS-/kommandotester stoppar otillåtna läsningar, kanter och writes; inget läckande antal. |
| AC-21 | Äldre manuella Shopping-rader/klienter och gammal handoff finns kvar. | Ingen destruktiv konvertering eller dubbel sanningskälla; kompatibilitet/uppdateringskrav är testat. |
| AC-22 | Nätfel efter save, stale revision eller avbruten beräkning. | Kvitto/retry utan dubblett; sammanställningen atomisk och blandade outputversioner inte falskt aktuella. |
| AC-23 | Användaren öppnar, markerar och laddar om på 320/390/1280 px. | Ritning ↔ del ↔ behov ↔ Shopping/plock fungerar i riktig appkod med versionsrätt underlag. |
| AC-24 | Riktig modell får vanlig svensk uppgift och ritverktyget är inte förladdat. | Den hittar/laddar verktyg, återanvänder/skapar definitioner, sparar ritning/listor och ändrar samma konstruktion utan användarskriven JSON. |
| AC-25 | Samma API används för hyllmodul, ram och ett nytt okänt testobjekt. | Ingen projektnamnsswitch eller ny generator; geometri, parametrar och listor håller ihop för stödda operationer. |
| AC-26 | Modellen väljer material utifrån egen bedömning eller en bild. | Valet förblir designbedömning; inga påhittade verifierade produkt-, mått- eller säkerhetsegenskaper. |

AC-24/25 kräver verkliga modellsamtal med syntetiska projekt. Förberedda tool calls bevisar parser/transport, inte självständigt beteende. SQL-, geometrikärna-, webbläsar- och livebevis hålls åtskilda. Kontrollera både att verktygen finns och att den faktiskt använda driftsversionen har dem. Ingen användares verkliga hus eller bilder ska behövas som testfixtur.

## 12. Byggordning och releasegränser

| Leverans | Bygg mot usecaset | Minsta bevis |
|---|---|---|
| A. Katalog och dynamiska egenskaper | Scope, kategorier/profiler, versionsbundna material/delar och find/read/ensure genom den befintliga verktygskatalogen. | AC-01–07, 20 och 22. Riktig modell söker/återanvänder/skapar; inte en oanvänd tabell. |
| B. Generell sammanställning | Parametrar, delinstanser, beroenden och vyer som förlängning av Artifact. En första deklarerad mängd geometriska operationer, inte objekttyper. | AC-08–11, 19, 23–26; samma sparade konstruktion ändras. |
| C. Härledda behov, uttag och plockförslag | Kanter till befintliga behov, dimensionellt lager, en verifierbar kapkandidat och versionsbundna plockförslag. | AC-12–13, 17–18 och 22. Ingen optimalitets- eller förbrukningsgaranti. |
| D. Dynamisk Shopping och samköp | Strukturerade inköpsfält, valfri produktvariant, packning efter sammanslagning och ny kompatibel handoff. | AC-14–16, 18 och 21–24; befintliga order/status bevaras. |

Leveranserna kan granskas separat, men användarflödet får inte beskrivas som färdigt efter bara A eller en ny verktygsbeskrivning. Det första slutliga genomgångstestet ska omfatta hela A–D, inklusive ändringen av samma ritning och dess listor.

Detta dokument ändrar inte drift. Innan framtida DDL/deploy: läs aktuell kod/schema och delad migrationshistorik, granska index/constraints/RLS, verifiera additiv migrering och gamla data, testa commands och appväg, dubbelkontrollera exakt diff/target, deploya matchande schema/Edge/frontend och gör readback. Använd inte historisk bootstrap på den delade databasen. Inga redan applicerade migrationer redigeras.

Materialprofilernas baskategorier och testdefinitioner kan seedas under behörig förvaltning. Det är inte samma sak som [byggkunskapsbibliotekets](building-knowledge.md) licens-/källgranskade bokseedning. AR är fortfarande pausat/utredning. Produktprisinhämtning, generell optimering, automatiska beställningar, normgodkännande, strukturell/VVS-/elsäkerhetscertifiering och full lagerlogistik ingår inte i detta första genomförande.

## 13. Underlag och beslut som återstår

**Kontrollerat i repo:** [nuvarande materialplaneringsschema](../supabase/migrations/20260913210000_material_planning.sql), [materialadaptern](../src/data/materialPlanning.ts), [Artifact-kontraktet](artifacts.md), [verktygssystemet](ask-bob-tools.md) och användarberättelserna ovan. De föreslagna tabellerna ska inte läsas som redan existerande på grund av dessa länkar.

**Teknisk referens:** PostgreSQLs [JSON-typer och dokumentdesign](https://www.postgresql.org/docs/current/datatype-json.html#JSON-DOC-DESIGN) beskriver hur strukturerad JSON och relationer kan kombineras, och [constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) beskriver integritetsgränser. Det är stöd för designvalet, inte verifiering av vår ännu oskrivna implementation.

Innan första kod-PR ska den valda geometrikärnans operationer, uttrycksformat, numeriska precision, kommando-/payloadgränser och den gamla Shopping-handoffens kompatibilitetsadapter dokumenteras med faktiska testfall. Tabellen ovan är tillräcklig som byggmål men ska inte köras som SQL. Att en ny egenskapsprofil kan lagras betyder inte att systemet automatiskt förstår ny fysik eller en ny geometrisk operation.

<a id="assembly-chain-plan"></a>
## 14. Teknisk genomförandeplan — 2026-10-02

**Status: planerad implementation, inte driftsatt kedja.** Användarens precisering är att Bob själv väljer delar och sammanfogningar och att inköpslistan härleds från samma konstruktion som ritningen. Detta är en plan för systemets verktyg, information och modellroller, inte en ny kravlista att lämna till användaren. Etapperna preciserar befintliga A–D och UC-001/003/005. Aktiv ordning ägs av [State](bob-delivery-flow.md#state).

### Utgångsläge och luckor

Kontrollerad kodbas: `e75f2e05d1e62f262be6dca2481d365a0874b410`. Drift- och modellbevis för det senaste hyllprovet finns hos [verifieringsägaren](foundation-verification.md#reviewer-output-ceiling--2026-10-02); kodläsningen här är inte en ny driftverifiering.

| Befintlig grund | Vad kedjan fortfarande behöver |
|---|---|
| [Materialkatalogen](material-catalog.md) har versionerade material/deldefinitioner, egenskaper och normaliserade enheter. | Binda exakta katalogrevisioner till konstruktionens delinstanser; utöka deldefinitioner med de ankare/bearbetningar som faktiskt stöds. Nuvarande `geometry_status=definition_only` är inte en färdig konstruktionsmodell. |
| `cad-schema.ts` har geometriska definitioner, placerade instanser, spel- och rörelsekontroller. | Typade förband mellan identifierade delar/ytor, materialbindningar, härledda parametrar och monteringens beroenden. Nuvarande `material_ref` och koordinater räcker inte. |
| `cad-parameters.ts` och lineage-koden binder mått och beräkningar till källor. | Utöka samma mekanismer till delar, förband och härledda listor; skapa inte en andra formelmotor. |
| `cad-worker/bob_cad/worker.py` exporterar geometri och projicerade konturer till STEP/SVG/PNG. | Ett uttryckligt kontrakt och en renderer för måttlinjer, måtttext och delbeteckningar. Att be designern försöka igen kan inte lägga till en saknad rendererförmåga. |
| [Materialplaneringen](material-planning.md) härleder vissa blankmått/antal från sparad CAD och har lager/allokering/Shopping. | Samlad stycklista inklusive förband och tillbehör, genomförbart råmaterialuttag, kompatibel samräkning och koppling från varje inköpsrad tillbaka till ursprungsdelarna. |
| [Kunskapsbiblioteket](building-knowledge.md) har åtta avgränsade källpaket; privata projektkällor läses separat. | Första konstruktionernas material- och förbandskunskap, versionsbundna produktanvisningar och kontrollerbar tillämpbarhet. Ett större sökindex är inte i sig byggkunnande. |
| Jobb, journal, ritningsuppdrag, kandidatgranskning och spar-/länkkvitton finns. | Checkpoints för konstruktion och härledningar, stegvis återhämtning samt skilda kontroller för kandidatens kvalitet respektive faktiskt levererad/sparad version. |

### Gemensamt arbetsunderlag

En konstruktion ska vara ett versionsbundet underlag under befintlig Artifact-identitet, med ett tydligt utkast före godkänd leverans. Detaljerad schemautformning hör till [Artifacts](artifacts.md), [CAD](cad-adapter.md) och `db/README.md`; tabellnamnen i §4 är inte ett mandat att skapa parallella identiteter.

Underlaget behöver stabila delinstans-ID:n, katalog-/materialrevisioner, parametrar i kanoniska enheter, position/riktning, namngivna anslutningsytor eller ankare och förband med egna ID:n. Ett förband anger vilka delar/ankare som möts, metod, placering och underbyggt behov av fästdon/tillbehör. Monteringsberoenden är en egen acyklisk ordning: ett fysiskt nät av förband kan legitimt innehålla cykler och får inte behandlas som samma graf. Upprepade instanser räknas en gång per förekomst.

Beräkningar, källrevisioner, arbetsval och olösta frågor ska följa modellen. Ritning, kaplista, monteringsunderlag, materialbehov och inköpsförslag får samma konstruktionsrevision och beräkningsversion. En ändring markerar berörda resultat inaktuella tills de räknats om; gamla beställningar, reservationer och utfört arbete skrivs inte om automatiskt.

### Verktyg som ska finnas i kedjan

Detta är förmågor att bygga eller utöka via befintlig verktygskatalog, inte redan registrerade API-namn. Verktygens instruktioner måste ange stödda operationer och lämna maskinläsbara fel med berörda del-/förbands-ID:n.

| Förmåga | Ansvar och resultat |
|---|---|
| Hämta underlag | Återanvänd projektläsare, exakt katalogläsning och `search_building_knowledge`. Returnera avgränsade källpaket med revision, tillämpbarhet och saknade uppgifter; skilj tekniskt läsfel från kunskapslucka. |
| Skapa, läsa och revidera konstruktion | Spara ett behörighetskontrollerat utkast med delar/förband, idempotens och förväntad revision. Uppdatera samma identitet efter rättning; privat uppdragshistorik blir inte delad projekttext. |
| Beräkna och validera | Servern löser stödda måttberoenden, enheter, antal, referenser, passning och tillåtna geometriska operationer. Koppla förband till explicita metoder och kontrollunderlag. Okänd hållfasthet blir inte godkänd genom en geometrikontroll. |
| Generera ritningspaket | Kompilera samma modell till befintlig CAD-motor och lägg till källbundna mått/beteckningar. Alla exporter och granskarbilder avser samma version. Unsupported-operation ska stoppa just det steget före betalda reparationsslingor. |
| Härleda listor och montering | Räkna delar, fästdon och tillbehör från instanser/förband. Beräkna kapförslag med format, sågspår och riktning; area ensam visar inte att en del ryms. Beskriv ordning och åtkomlighet med del-/förbandsreferenser, inte en fristående AI-lista. |
| Leverera och verifiera | Använd befintliga kanoniska spar-, Step/Task-länk- och Shopping-kommandon. Kontrollera kvitton och återläs rätt version efter sparande; återförsök bara den saknade operationen. Inköpsförslag är inte en genomförd beställning. |

### Information och modellroller

Första informationspaketet avgränsas till skivmaterial, relevanta sammanfogningar, fästdon, råformat/kapning och monteringsåtkomst för provfallen. Använd katalogens typade egenskaper och kunskapsbibliotekets källregister, med utgåva, rättigheter, tillämpningsområde och indragning. Produktberoende val behöver relevanta tillverkaruppgifter. Generella regler, en produkts instruktioner och projektets mått ska förbli separata källtyper. Ny extern hämtning/import är en egen kontrollerad förmåga; den får inte antas finnas i den nuvarande sökningen.

| Roll | Planerat ansvar och modellstrategi |
|---|---|
| Bob | Äger uppdraget, konstruktionsval och framdrift. Återanvänder verktygsresultat och sparade checkpoints; ett processteg kräver inte alltid ett nytt modellanrop. |
| Källinsamling | Exakta uppslag och filter i kod först. Använd en mindre modell för avgränsat källurval när det behövs, utan att låta dess sammanfattning ersätta mått/tabeller/bilder. |
| Konstruktion | En kapabel resonemangsmodell föreslår strukturerade delar, förband och ändringar. Utgå från nuvarande designer som baslinje och prova starkare alternativ endast mot samma uppgifter och verktyg. |
| Beräkning och rendering | Deterministisk kod och befintlig CAD-kärna. Ingen språkmodell behövs för att summera styckantal, lösa stödda formler eller kopiera mått till ritningen. |
| Oberoende granskning | Separat kontext med originalkrav, källor, exakt modell, maskinkontroller och bilder. Nuvarande reviewer med 50 000 tokens är baslinje; större modell eller annan resonemangsnivå är provkandidater, inte beslutade byten. Ett annat modellnamn garanterar inte oberoende kvalitet. |

Innan modellprov: läs aktuella driftinställningar och verifiera kandidaternas verktygs-, schema- och bildstöd i aktuell leverantörsdokumentation. Jämför på låsta indata och flera körningar: korrekt färdig leverans, upptäckta kända fel, falska godkännanden/stopp, kostnad per accepterad leverans och total tid. Börja med nuvarande roller och en avgränsad alternativ kandidat; besluta utifrån resultaten om någon roll behöver bytas. Inget nytt modellköp, fine-tuning, ytterligare agentlager eller större generell kunskapsdatabas är en förutsättning för första genomgående provet.

### Etapper och bevis före nästa steg

| Etapp | Avgränsad leverans och kodägare | Klart när |
|---|---|---|
| K0. Fastställ luckor och steggränser | Gör en kontraktsdiff mot faktisk drift. Spåra senaste budgetstoppet genom både `bob-model-budget.ts` och `drawing-budget.ts`/databasreservationer. Skilj konstruktions-/ritningskrav från senare spar-/länkkrav i `cad-review.ts` och intake. Specificera måttsättningsförmågan. | Varje lucka har kodägare, reproducerbart fel, föreslagen ändring och positivt motprov. Budgetfel visar faktisk gräns, användning och återupptagningsvillkor; ingen gräns höjs blint. |
| K1. Versionerad konstruktion | Utöka katalog/Artifact/CAD-kontraktet med delinstanser, förband, källbindningar och persistenta utkast. Använd befintlig parameter- och versionsmekanik. | Bob kan skapa, spara, läsa och ändra konstruktionen utan rendering. ID:n består; trasiga referenser, fel enheter, samtidiga ändringar och obehörig åtkomst avvisas. |
| K2. Val och kontroll av konstruktionen | Koppla konstruktörens strukturerade ändringar till material-/förbandskällor, serverberäkningar och generiska valideringsregler. Begränsa första kontraktet till stödda operationer, inte namngivna möbeltyper. | Bob tar själv fram hela provkonstruktionen. Oberoende kontroller hittar felvänd del, fel måttkedja, saknat förband och ogrundat produktval; korrekt modell går vidare. |
| K3. Måttsatt ritning och separat leveranskontroll | Utöka CAD-adapter/worker med mått och delnummer. Kandidatgranskaren bedömer kvalitet före publicering; efterföljande leveranskontroll verifierar sparande, länkar och återläsning. | Samma modell ger läsbara måttsatta vyer. Granskning kan godkänna en osparad kandidat utan att hela uppdraget markeras klart. Exakt godkänd version sparas och öppnas från rätt arbetssteg. |
| K4. Kaplista, montering och inköpsförslag | Härled BOM inklusive förband, verifierbart råmaterialuttag och monteringsberoenden. Utöka befintligt material-/lager-/Shopping-flöde för kompatibel samräkning och spårbara bidrag. Kan utvecklas efter K2 parallellt i arkitekturen med ritningsutdata, men håll ett implementationspass aktivt åt gången. | Varje listpost kan härledas till rätt del/förband/version. Sågspår, materialriktning, lager och förpackningar påverkar beräkningen korrekt; inga dubbla reservationer eller påstådda inköp. |
| K5. Ändring, återhämtning och modellval | Koppla konstruktionens checkpoints och härledningar till befintliga jobb/journaler. Reservera budget för granskning och färdigställande, med separat token-, kostnads-, anrops- och tidsredovisning. Kör modelljämförelsen ovan. | Ett avbrott återupptar kvarstående steg utan dubbel debitering eller dubbla leveranser. Måttändring uppdaterar rätt underlag med bevarad historik. Vald modellkonfiguration har mätbar kvalitet/kostnad på hela kedjan. |

K0 ska inte växa till ett fristående omtag av hela Bob. Leverera därefter K1–K5 genom samma lilla genomgående prov; återanvänd befintliga katalog-, Artifact-, material- och jobbgränser. Inga nya objektspecifika `shelf`-verktyg eller parallella BOM-/Shopping-register.

### Acceptans för den sammanhängande kedjan

Första syntetiska provet motsvarar hyllans 600 × 800 × 300 mm, två gavlar och tre mellanliggande skivdelar, med explicit vald materialtjocklek och förbandsmetod som testdata. Bob ska själv skapa delarna och relationerna från vanlig beställning; fixturen får inte förse modellen med färdiga verktygsanrop. För 18 mm gavlar utan ytterligare spel ger den deklarerade relationen 600 − 2 × 18 = 564 mm mellanliggande bredd; ändras byggsättet måste formeln ändras, inte måttet kopieras blint.

Provet följer konstruktion → kontroller → måttsatt ritning, kaplista, monteringsunderlag och inköpsförslag → spar-/länkkvitton → återöppning. Ändra därefter bredden och materialtjockleken var för sig och visa påverkan på delar, förband och listor, med oförändrad historik. Prova också en annan konstruktion med samma generiska verktyg och nya mått.

Negativa prov omfattar fel delrelation, omöjligt råmaterialuttag trots tillräcklig total area, saknat fästdonsunderlag, gammal källrevision, dubbel reservation, falskt krav på sparande före kandidatgranskning samt avbrott efter sparande men före länkning. Saknad kunskap eller verktygsförmåga ger en konkret lucka, inte en extra fråga om redan kända användarmått. Det ska även gå att skilja ett användbart koncept från komplett tillverkningsunderlag.

Redovisa deterministiska enhets-/SQL-/geometriprov, verkliga modellanrop och Auth/HTTP-/mobilprov separat. Kontrollera relevant UI på 320/390/1280 px och återöppning av annan behörig deltagare. Samla resultat och kostnader hos [verifieringsägaren](foundation-verification.md); behåll P0/P3 och övrig P4-acceptans öppna tills deras egna kriterier är uppfyllda. Den här dokumentationsändringen tillämpar inget schema, byter ingen modell och driftsätter ingen ny förmåga.
