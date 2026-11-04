# P2.1 – Kortare verktygsväg för källavstämning (2026-11-04)

**Status:** Implementerad som versionerad AI-katalogändring; verklig AI-/kostnadsacceptans återstår. Ingen ny modell, leverantör, tabell, roll, Edge-funktion eller genväg för skrivbehörighet införs.

## Verklig baslinje (Lilla ladan)

Två riktiga Bob-turer 2026-11-04, observerade via `bob.execution_events` och exakta sparade revisionskvitton. Dessa är **inte** jämförbara A/B-prov:

| Scenario | Modellanrop | `describe_tool` | Konstruktionsläsningar | Modelltidens kostnadstelemetri |
| --- | ---: | ---: | ---: | ---: |
| Jämför konstruktion med vald lösning | 23 (21 Opus + 2 Sonnet) | 5 | 9 | cirka $2,90 |
| Korrigera projektbeskrivning och dokumentera avstämning | 21 | 6 | 6 | cirka $2,44 |

Turerna slutade utan jobb-error, men kostnaderna och antalet manualrundor är för höga. Några av konstruktionsläsningarna kan vara nödvändig **olika** paginering; vi har inte bevis för att nio identiska reads gjordes. Implementera därför inte en osäker turn-global konstruktionscache som kan dölja en ändrad Solution/target, revocation eller ny konstruktion.

## Åtgärd

`bob.tools.operation_followups` har redan kodimplementerade tillstånds- och policykontroller i `project-tools/session.ts`. P2 återanvänder detta via endast en ny version av befintligt `bob.tools`, med två konservativa övergångar:

- Lyckad `read_solution_context` gör `change_solution_evidence` tillgänglig i **nästa** modellsteg, när verktygets vanliga policy och write-gate medger det. Detta stöder direktändringar av källkopplingar utan separat manualfråga.
- Lyckad `read_project_edit_context` gör `edit_project_record` tillgänglig i **nästa** modellsteg, utan ytterligare manualfråga. Läsaren laddas inte automatiskt vid vanlig Solution-läsning; Bob måste uttryckligen öppna redigeringskontexten.

Inga skrivningar sker av denna mekanism. Misslyckad läsning, saknad authority, gammal modellbatch, schemaavvikelse och tillbakadragen behörighet ger **inte** extra access. Befintliga katalogmanifester och pågående jobb är versionslåsta och påverkas inte.

## Verifiering och release

- SQL har provkörts inne i en transaktion med kontroll av aktiverat kataloginnehåll och sedan `ROLLBACK`; efterkontroll visar fortfarande produktionens ursprungliga `bob.tools` v43 med 18 övergångar.
- Regressionstester i `tests/bob-p2-source-followups.test.ts` granskar lyckad läsning, misslyckad läsning, nästa-steg-gräns, återställd checkpoint, RLS/policy-gates, äldre manifest, schemaavvikelse och idempotent katalogpublicering. Testsuiten kräver repo/PGlite och får inte kallas godkänd förrän den verkligen körts.
- Kontrollera att inga Bob-jobb kör, kör riktade tester och läs den mergade SQL-filen innan migrationen appliceras. Efteråt återläs aktiv `bob.tools`, exakta appended followups och migrationshistorik; synka versionsfilnamnet vid behov.
- Nästa riktiga test mäter `describe_tool`, antal Opus-anrop, cache misses, korrekt sparade resultat, RLS, start/slut och kostnad mot de två tidigare turerna. Ingen garanterad procentuell kostnadssänkning påstås utan ny observation.

**Avgränsning:** Detta är P2.1, inte en ny planerare och inte en generell lösning på all kontextkostnad. Eventuella nästa P2-steg måste baseras på mätta, icke-identiska förfrågningar och reell uppgiftskvalitet. 
