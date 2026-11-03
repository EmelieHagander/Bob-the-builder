-- One-time, owner-authorised living-plan backfill for five existing projects.
-- Hosted migration ledger: 20261103205118_living_plan_backfill_five_projects.
-- Decision source: project organiser approved the exact five plan outlines in
-- the 2026-11-03 Bob development conversation. This is administrative data
-- repair, NOT evidence that measurements, drawings or construction are approved.
-- No schema changes, construction edits, target/solution revisions or Task
-- status edits. Fail closed if the project, plan or Task baseline has changed.
-- Existing proposal revisions are retained and marked rejected, not deleted.

do $backfill$
declare
  v_owner constant uuid := '2095dcd5-f816-4f9d-b30e-9369c04310f1';
  -- checks tuple: [requirement_type, title, description, responsible_kind].
  v_plans jsonb := $plan_data$
[
  {
    "id":"p_54859d59bbea463bb5dea65fc22ce587",
    "expected_next_revision":2,
    "expected_steps":7,
    "area_id":"a_d4a2cb6e870d44778f55781dc8c1234b",
    "summary":"Lilla ladan: samordna befintlig konstruktion, granska sju fönster i små steg och färdigställ byggunderlag.",
    "steps":[
      {
        "title":"Samordna lösningen och befintlig konstruktion",
        "goal":"Knyt dagens valda cirka 3 × 6 m-lösning till den sparade konstruktionen utan att radera eller tolka om dess 78 instanser.",
        "notes":"Konstruktion rev 4 och dess äldre målbindning måste jämföras med nu valt mål. Tidigare 4 × 7 m-plan är inaktuell. Mått i projektet är uppskattningar, inte kontrollerade platsmått.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["check","Jämför val och befintlig modell","Dokumentera exakt vilka delar av konstruktion rev 4 som motsvarar dagens lösning och var kopplingen eller FORM-mappning saknas.","bob"],
          ["decision","Red ut dimensions- och revisionskonflikten","Bekräfta 3 × 6 m som designriktning och märk saknade kontrollmått som öppna; skriv inte om konstruktion eller uppmätta fakta på chans.","bob"]
        ]
      },
      {
        "title":"Placera och granska fasadöppningarna",
        "goal":"Föreslå och konstruera sju fönster med en begriplig fasad eller avgränsad del i taget.",
        "notes":"Konrad ska spara och tekniskt kontrollera en avgränsad ändring, därefter ska Bob visa exakt revision och fråga naturligt om placeringen stämmer innan nästa fasad. Inget globalt godkännande antas.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa varje fönsterplacering","Redovisa föreslagna placeringar på respektive fasad och vilka av totalt sju fönster som återstår; undvik alla fönster i en odelad operation.","bob"],
          ["check","Kontrollera sparad revision","Knyt varje avgränsad förändring till ett faktiskt sparat konstruktionsresultat och redovisa tekniska kontrollfel öppet.","bob"],
          ["approval","Stäm av visuellt mellan fasader","Låt användaren svara på om den visade fasaden stämmer innan nästa lämpliga avsnitt; inget formellt knappgodkännande för varje intern verktygsåtgärd.","unassigned"]
        ]
      },
      {
        "title":"Fastställ djurutrymmen och loft",
        "goal":"Utforma funktionella djurdelar, tillträden, ventilation och de två loften så att utformningen kan byggas.",
        "notes":"Behåll osäkra behov och vinterförhållanden öppna tills de undersökts.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["decision","Bekräfta rumsprogram och användning","Fördela djurutrymmen, dörrar, flöden och två loft utifrån verkliga behov och tillgänglig byggvolym.","bob"],
          ["check","Kontrollera funktion och djurmiljö","Gå igenom åtkomst, ventilation, rengöring, vinterbruk och utrymningsfrågor utan att påstå att regler redan är verifierade.","bob"]
        ],
        "task_ids":["t_65010afa70e142d99a4cc36559d4cda0"]
      },
      {
        "title":"Utred plats, grund och flyttbarhet",
        "goal":"Ta fram ett förankrat beslut om läge, sten-/krypgrund, lyftbarhet och eventuella lov eller djurkrav.",
        "notes":"Särskilj platsbesök och myndighetsbedömning från Bobs designantaganden.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["measurement","Undersök faktiska mark- och grundförhållanden","Kontrollera nivåer, avstånd, bärighet, fukt och åtkomlighet för planerad grund och eventuell flytt.","unassigned"],
          ["check","Utred regler och hantering","Kontrollera lov, placering och relevanta djurregler samt hur byggnaden praktiskt kan lyftas eller flyttas.","bob"]
        ],
        "task_ids":["t_fe53919be6cc4dfe9685a0cdaf7fbd0d","t_0e6288e3a177449c9723b478d82d4747"]
      },
      {
        "title":"Detaljkonstruera och kontrollera helheten",
        "goal":"Samordna stomme, tak, öppningar, loft och infästningar i en kontrollerbar konstruktionsmodell.",
        "notes":"Konstruktionsdelar får hanteras stegvis; teknisk modellkontroll är inte samma sak som verkligt bärighetsintyg.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["check","Kontrollera konstruktionens samband","Granska dimensioner, anslutningar, öppningsförstärkningar, laster och loft innan byggunderlag fastställs.","bob"],
          ["drawing","Visa sammanhängande modell","Redovisa modellens exakta revision och återstående osäkerhet; be om användarens naturliga designåterkoppling.","bob"]
        ]
      },
      {
        "title":"Ta fram ritningar och byggunderlag",
        "goal":"Skapa begripliga ritningar, kap-/materiallista och byggordning från samma kontrollerade revision.",
        "notes":"Listor får inte utges för exakta om motsvarande modell eller materialantaganden saknas.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["drawing","Versionsbundna ritningar","Tillhandahåll relevant 2D/3D och måttsättning med länk till sparad konstruktionsrevision.","bob"],
          ["material_requirement","Kap- och inköpsunderlag","Beräkna delar, spill och beslag mot samma revision och märk öppna materialval.","bob"]
        ]
      },
      {
        "title":"Bygg och dokumentera resultatet",
        "goal":"Genomför byggandet säkert och dokumentera avvikelser från ritningen.",
        "notes":"Fysisk färdigställning kräver verklig kontroll, inte ett AI-genererat byggkvitto.",
        "phase":"build", "owner":"unassigned",
        "checks":[
          ["check","Verifiera byggd stomme och funktion","Dokumentera faktisk montering, öppningar, stabilitet och användningsfunktion på plats.","unassigned"],
          ["photo","Spara avvikelser och färdigt skick","Fotografera byggskeden och slutresultat, och uppdatera plan eller konstruktion vid verkliga avvikelser.","unassigned"]
        ]
      }
    ]
  },
  {
    "id":"p_5b68be5cb157461c93b670c7a39922b4",
    "expected_next_revision":2,
    "expected_steps":5,
    "area_id":"a_39ae94869ae7446593822ffa090bddba",
    "summary":"Grindar: två skjutgrindsblad på sidospår, utan gjutning, från kontrollmått till provad funktion.",
    "steps":[
      {
        "title":"Verifiera öppning och sidobanor",
        "goal":"Mät öppning, marknivåer och tillgängliga sidolängder för två grindblad omkring 3 m vardera.",
        "notes":"Angivna cirka 6 m är en uppgift, inte en platsverifierad mätning. Den äldre slaggrindsplanen är inte längre aktuell.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["measurement","Mät öppning och skjutvägar","Dokumentera bredd, höjd, fall, sidosvängrum och faktiskt möjligt skenläge på plats.","unassigned"],
          ["decision","Bekräfta tvådelad skjutlösning","Kontrollera att båda bladen kan löpa åt sidorna utan konflikt med mark, hinder eller gångpassage.","bob"]
        ],
        "task_ids":["t_7e5735d006a1404bba42db51b29be8ab"]
      },
      {
        "title":"Välj skena, hjul och bärning",
        "goal":"Föreslå en säker skjutgrindslösning med sidoskenor och utan betonggjutning.",
        "notes":"Bärning och infästning beror på faktiska mark- och stolpförhållanden.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["check","Pröva bärning och styrning","Utred skenor, hjul, styrning, fundament/markinfästning, frost och stabilitet med förutsättning utan gjutning.","bob"],
          ["decision","Välj genomförbart system","Visa val och alternativ med krav på eventuell platskontroll innan dimensionering låses.","bob"]
        ],
        "task_ids":["t_8a3bbc0838d84d8b9078cc8e69eb70b1"]
      },
      {
        "title":"Utforma grindblad och funktioner",
        "goal":"Utforma grindblad, öppningsstopp, möte, låsning och eventuell återgång.",
        "notes":"Automatisk självstängning är en fråga att utreda, inte ett beslutat system.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa två blad och rörelse","Skissa båda bladens konstruktion, gång och stopp i rätt öppning.","bob"],
          ["check","Bedöm låsning och återgång","Kontrollera klämrisk, stopp, manuell hantering och om återgång är möjlig utan oönskad kraft.","bob"]
        ],
        "task_ids":["t_aefa7419bb23465da2b3cc58418860a7"]
      },
      {
        "title":"Ta fram konstruktions- och materialunderlag",
        "goal":"Färdigställ måttsatta ritningar, material, beslag och monteringsföljd för vald lösning.",
        "notes":"Håll mått och komponentval spårbara till kontrollerat underlag.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["drawing","Lås byggbar modellrevision","Ta fram ritningar och detaljer för skena, blad, beslag och infästning med revisionsreferens.","bob"],
          ["material_requirement","Beräkna material och beslag","Ta fram kaplista, hjul/skenor och inköpsbehov från vald konstruktion.","bob"]
        ]
      },
      {
        "title":"Montera och funktionskontrollera",
        "goal":"Montera grindarna på plats och bekräfta säker, lättskött rörelse och låsning.",
        "notes":"Ingen fysisk verifiering görs av migreringen.",
        "phase":"build", "owner":"unassigned",
        "checks":[
          ["check","Prova full rörelse och stopp","Kontrollera gång, klämrisker, stabilitet, låsning och väder-/markpåverkan på plats.","unassigned"],
          ["photo","Dokumentera montage och ändringar","Spara verkligt resultat och justeringar så ritningar och underlag kan revideras vid behov.","unassigned"]
        ]
      }
    ]
  },
  {
    "id":"p_barnrum_vaningssang",
    "expected_next_revision":1,
    "expected_steps":7,
    "area_id":"a_br_sang",
    "summary":"Barnrum: samordna befintlig våningssäng, funktionsgavel, ribbottnar och lådor samt ta fram byggunderlag.",
    "steps":[
      {
        "title":"Samordna huvudmått och proportioner",
        "goal":"Stäm av sparade rums-/madrassmått, mockup och befintlig konstruktion innan detaljarbetet fortsätter.",
        "notes":"Rumsuppgifter 3970 × 2700 mm, takhöjd 1920 mm, vägg 1900 mm och madrass 800 × 1650 × 120 mm har olika proveniens. Konstruktion rev 20 med 53 instanser saknar FORM-mappningar.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["measurement","Red ut fria mått och källor","Knyt nuvarande rumsmått och madrassmått till rätt källor och märk osäkra uppgifter; härled inte verifierade mått från en mockup.","bob"],
          ["drawing","Jämför modell och önskad proportion","Visa befintlig modell mot mockup och samla beslut om ändringar utan att skriva om avslutad Task.","bob"]
        ],
        "task_ids":["t_b11eb5c598124040b56f979918409d59","t_7abdb3ba75e4458bb0c2e01f490564fd"]
      },
      {
        "title":"Utforma vänster funktionsgavel",
        "goal":"Färdigställ bokhylla, bakpanel och stege som en sammanhållen byggbar gavel.",
        "notes":"Lös steg-/hyllplacering i små, visuellt granskbara modelländringar.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa gavelns funktioner","Redovisa hyllor, stege och panel i relation till sängens gångutrymme och säker åtkomst.","bob"],
          ["check","Granska anslutningar och tillgänglighet","Kontrollera infästningar, passage och åtkomst med osäkerheter öppna.","bob"]
        ],
        "task_ids":["t_b80880a9a32e4cf8bf268dde09b27614"]
      },
      {
        "title":"Utforma bäddar, ribbottnar och skydd",
        "goal":"Byggbar bärande bäddstruktur med rätt ribbavstånd, ventilation och fallskydd.",
        "notes":"Fysisk barnsängssäkerhet kräver separat kontroll; teknisk modellkontroll räcker inte.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["check","Kontrollera bärning och ventilation","Beräkna/bedöm bäddram, bärlister, ribbor, stöd och luftning utifrån faktiska mått.","bob"],
          ["check","Granska skydd och stegsäkerhet","Kontrollera fallrisk, öppningar, kant- och klämrisk innan underlag betraktas som byggklart.","bob"]
        ],
        "task_ids":["t_0c9fa0f6315547c28f1143a9b888d238"]
      },
      {
        "title":"Utforma de tre underlådorna",
        "goal":"Utforma tre utdragbara lådor med hjul och fungerande frigång under sängen.",
        "notes":"Gör en lådmodul åt gången, kontrollera frigång och upprepa först därefter.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa lådindelning och rörelse","Granska tre lådors bredd, höjd, åtkomst och utdragsväg med verkligt golvutrymme.","bob"],
          ["check","Kontrollera hjul och infästningar","Välj bärning och stopp med rimligt material- och monteringsutrymme.","bob"]
        ],
        "task_ids":["t_1973427d461f4a3ca5649d394112f1c6"]
      },
      {
        "title":"Samordna och granska hela modellen",
        "goal":"Samla gavel, bäddar, stege och lådor i en versionsbunden modell som går att granska.",
        "notes":"Be om naturlig designåterkoppling på begriplig detaljnivå innan slutliga ritningar.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Granska helhetens passform","Visa komplett 2D/3D med korrekta frigångar och förankrad revision.","bob"],
          ["check","Samla öppna tekniska risker","Redovisa kvarvarande mått-, hållfasthets- och säkerhetskontroller ärligt.","bob"]
        ]
      },
      {
        "title":"Ta fram byggunderlag och listor",
        "goal":"Skapa måttsatta ritningar, kaplista, material- och inköpslista samt enkel byggordning.",
        "notes":"Koppla alla leveranser till den godkända modellen; gå inte vidare med uppskattningar som låtsas vara exakta.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["drawing","Versionsbundna ritningar och monteringsordning","Ta fram ritningar för komponenterna och deras sammanfogning från exakt sparad revision.","bob"],
          ["material_requirement","Ta fram kap- och inköpslista","Härled material, beslag och antal ur vald modell, med synliga antaganden.","bob"]
        ],
        "task_ids":["t_d55f0087e0134b2ab1a4601c4a97be41","t_ddb6dbf70a4d47f2ab3091fbacd58c11"]
      },
      {
        "title":"Bygg och kontrollera",
        "goal":"Montera sängen och dokumentera praktisk funktion, infästning och säkerhet.",
        "notes":"Inga byggmoment eller säkerhetsprov blir klara genom planmigreringen.",
        "phase":"build", "owner":"unassigned",
        "checks":[
          ["check","Utför fysisk kontroll","Verifiera bärning, stabilitet, stege, fallskydd och lådornas funktion på plats.","unassigned"],
          ["photo","Dokumentera slutresultat","Spara verkliga mått, ändringar och foton för uppdaterad as-built-version.","unassigned"]
        ]
      }
    ]
  },
  {
    "id":"p_dfd7589b92114c4696deaffd1ced3a90",
    "expected_next_revision":1,
    "expected_steps":6,
    "area_id":null,
    "summary":"Våningssäng2: stäm av vald v7-lösning, färdigställ stomme och skydd, granska och bygg.",
    "steps":[
      {
        "title":"Stäm av v7 mot sparad konstruktion",
        "goal":"Jämför vald rak v7-utformning med den sparade konstruktionen och identifiera kvarvarande skillnader.",
        "notes":"Konstruktion rev 13 har 58 instanser utan FORM-mappningar. Detta projekt har inga egna aktuella kontrollmått; låna inte omärkligt mått från andra sängprojekt.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa vald form och modell","Jämför rak form, stege på rumssidan, väggsidans plywood, öppen front och enbart nödvändiga skydd med aktuell modell.","bob"],
          ["measurement","Klarlägg projektets egna mått","Lista nödvändiga plats-, bädd- och frihöjdsmått utan att anta att andra projekt har samma förutsättningar.","unassigned"]
        ]
      },
      {
        "title":"Färdigställ stomme och steggavel",
        "goal":"Konstruera huvudstomme och steggavel med tydliga kopplingar och byggbar åtkomst.",
        "notes":"Gör avgränsade ändringar och visa dem före mer omfattande omarbete.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Granska stomme och stegsida","Visa dimensioner och placering utifrån vald v7-form och aktuella mått.","bob"],
          ["check","Kontrollera anslutningar och stabilitet","Bedöm bärning och infästningar, och dokumentera kvarvarande fysisk verifiering.","bob"]
        ]
      },
      {
        "title":"Färdigställ ribbor och skydd",
        "goal":"Ta fram ribbottnar och nödvändiga skydd utan att sluta den avsedda öppna fronten.",
        "notes":"Behåll barnsängssäkerhet som ett verkligt kontrollbehov.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["check","Dimensionera bäddstöd","Kontrollera ribbavstånd, ventilation, bärning och säkra fästen.","bob"],
          ["drawing","Visa skyddens placering","Illustrera fallskydd, väggsidans panel och åtkomst utan att ändra vald form oavsiktligt.","bob"]
        ]
      },
      {
        "title":"Granska modellen",
        "goal":"Säkerställ att sparad 2D/3D motsvarar användarens valda lösning.",
        "notes":"Samla återkoppling naturligt och knyt tekniskt resultat till exakt revision.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa hela v7-modellen","Redovisa exakt revisionslänk och placering av stomme, stege, panel och skydd.","bob"],
          ["approval","Få naturlig designåterkoppling","Stäm av avsikt och utseende före byggunderlag; teknisk sparning är inte visuellt godkännande.","unassigned"]
        ]
      },
      {
        "title":"Ta fram byggunderlag",
        "goal":"Gör byggbara ritningar, kaplista, material och ordning från vald revision.",
        "notes":"Särskilj exakta källmått från uppskattningar.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["drawing","Detaljera byggmått och montage","Skapa underlag med säkra anslutningar och byggföljd länkat till modellrevision.","bob"],
          ["material_requirement","Beräkna delar och inköp","Ta fram kap-/materiallista och märk ej avgjorda beslag eller dimensioner.","bob"]
        ]
      },
      {
        "title":"Montera och kontrollera",
        "goal":"Bygg sängen och kontrollera säkerhet och funktion på plats.",
        "notes":"Fysisk kontroll kan inte uppfyllas automatiskt.",
        "phase":"build", "owner":"unassigned",
        "checks":[
          ["check","Kontrollera byggd säng","Verifiera stabilitet, stege, skydd, bäddstöd och infästningar i verkligheten.","unassigned"],
          ["photo","Dokumentera as-built","Spara ändringar, avvikelser och slutligt utförande med bilder.","unassigned"]
        ]
      }
    ]
  },
  {
    "id":"p_cde775fcc8b049818871e0511079a351",
    "expected_next_revision":1,
    "expected_steps":4,
    "area_id":null,
    "summary":"Trefackskompost: undersök befintlig kompost, utforma tre fack och ta fram byggunderlag.",
    "steps":[
      {
        "title":"Undersök befintlig kompost och plats",
        "goal":"Dokumentera befintlig kompost, tillgänglig yta, mark och önskad användning före detaljdesign.",
        "notes":"Tre ungefär 1,5 × 1,5 m fack är ett önskemål, inte uppmätta färdiga mått. Inget valt konstruktionsalternativ finns ännu.",
        "phase":"concept", "owner":"bob",
        "checks":[
          ["measurement","Mät kompost och plats","Kontrollera befintlig storlek, tillgänglig bredd/djup, underlag och åtkomst för tömning.","unassigned"],
          ["photo","Dokumentera befintligt utförande","Spara foton och notera återanvändbara delar och eventuella skador.","unassigned"]
        ]
      },
      {
        "title":"Utforma tre fack",
        "goal":"Välj indelning, väggar, öppningar och åtkomst för en fungerande trefackskompost.",
        "notes":"Arbeta från observerad plats och återbruk innan materialdimensioner låses.",
        "phase":"design", "owner":"bob",
        "checks":[
          ["drawing","Visa plan och enkel 3D","Illustrera tre ungefär lika stora fack, hantering och ventilations-/dräneringsväg.","bob"],
          ["decision","Stäm av lösningen","Få återkoppling på åtkomst och utformning innan detaljkonstruktionen fortsätter.","bob"]
        ]
      },
      {
        "title":"Ta fram konstruktion och material",
        "goal":"Detaljera sektioner, infästningar och mängder med hänsyn till fukt, markkontakt och återbruk.",
        "notes":"Inga materialval eller exakta längder antas vara bestämda ännu.",
        "phase":"planning", "owner":"bob",
        "checks":[
          ["drawing","Gör byggbara ritningar","Visa fack, ribbor/paneler, stolpar och löstagbara delar med verifierade mått.","bob"],
          ["material_requirement","Sammanställ kap- och inköpslista","Beräkna behövligt virke, beslag och återbrukade delar med spårbara antaganden.","bob"]
        ]
      },
      {
        "title":"Bygg och kontrollera",
        "goal":"Bygg facken och kontrollera användbarhet, stabilitet och dränering i verkligheten.",
        "notes":"Planen är inte ett intyg om färdigt bygge.",
        "phase":"build", "owner":"unassigned",
        "checks":[
          ["check","Prova praktisk funktion","Kontrollera luckor, tömning, stabilitet, ventilation och markkontakt på plats.","unassigned"],
          ["photo","Dokumentera resultatet","Spara färdiga foton och uppdatera framtida plan vid avvikande utförande.","unassigned"]
        ]
      }
    ]
  }
]
  $plan_data$::jsonb;
  v_plan jsonb;
  v_step jsonb;
  v_check jsonb;
  v_project text;
  v_area text;
  v_revision integer;
  v_position integer;
  v_requirement_position integer;
  v_step_id uuid;
  v_focus_step_id uuid;
  v_task_id text;
  v_task_stamp timestamptz;
  v_task_area text;
  v_previous_step uuid;
  v_task_links jsonb;
  v_task_position integer;
  v_expected_tasks integer;
  v_actual_tasks integer;
  v_count integer;
  v_head bob.project_plans;
begin
  perform set_config('lock_timeout','5s',true);
  if jsonb_array_length(v_plans) <> 5 then
    raise exception 'living_plan_backfill: expected exactly five projects';
  end if;

  for v_plan in select value from jsonb_array_elements(v_plans) loop
    v_project := v_plan->>'id';
    v_area := v_plan->>'area_id';
    v_revision := (v_plan->>'expected_next_revision')::integer;
    v_task_links := '[]'::jsonb;
    v_focus_step_id := null;
    v_expected_tasks := 0;

    -- The same direct organiser is present in all five projects. This actor
    -- is attributed only because the organiser explicitly approved this
    -- administrative backfill; no forged request.jwt.claim.sub is used.
    if not exists (
      select 1 from bob.projects p join bob.people member on member.project_id=p.id
      where p.id=v_project and member.auth_user_id=v_owner
        and member.access_origin='direct' and member.role='Organiser'
    ) then
      raise exception 'living_plan_backfill: organiser access changed for %', v_project;
    end if;
    if v_area is not null and not exists (
      select 1 from bob.areas where id=v_area and project_id=v_project and archived_at is null
    ) then
      raise exception 'living_plan_backfill: Area missing or archived for %', v_project;
    end if;

    insert into bob.project_plans(project_id) values(v_project) on conflict do nothing;
    select * into v_head from bob.project_plans where project_id=v_project for update;
    if v_head.current_revision is not null or v_head.focus_step_id is not null
      or v_head.next_revision <> v_revision
    then
      raise exception 'living_plan_backfill: plan baseline changed for %', v_project;
    end if;

    select count(*) into v_count from bob.project_plan_revisions where project_id=v_project;
    if v_count <> v_revision-1 then
      raise exception 'living_plan_backfill: revision count changed for %', v_project;
    end if;
    if v_revision=2 then
      if not exists (
        select 1 from bob.project_plan_revisions
        where project_id=v_project and revision=1 and status='proposed'
          and based_on_revision is null and proposed_by=v_owner
      ) then
        raise exception 'living_plan_backfill: previous proposal changed for %', v_project;
      end if;
      update bob.project_plan_revisions set status='rejected', decided_at=clock_timestamp()
      where project_id=v_project and revision=1 and status='proposed';
    end if;

    insert into bob.project_plan_revisions
      (project_id,revision,status,based_on_revision,summary,reason,proposed_by,approved_by,decided_at)
    values
      (v_project,v_revision,'approved',null,v_plan->>'summary',
       'Engångsbackfill: projektorganisatörens uttryckliga godkännande i ChatGPT 2026-11-03. Administrativt införd som arbetsplan; inga mått, ritningar eller fysiska resultat godkänns här.',
       v_owner,v_owner,clock_timestamp());

    v_position := 0;
    for v_step in select value from jsonb_array_elements(v_plan->'steps') loop
      v_position := v_position + 1;
      v_step_id := gen_random_uuid();
      if v_position=1 then v_focus_step_id:=v_step_id; end if;
      insert into bob.project_plan_steps
        (project_id,plan_revision,step_id,position,title,goal,state,area_id,responsible_kind,responsible_person_id,notes,phase)
      values
        (v_project,v_revision,v_step_id,v_position,v_step->>'title',v_step->>'goal',
         case when v_position=1 then 'active' else 'planned' end,v_area,
         v_step->>'owner',null,v_step->>'notes',(v_step->>'phase')::bob.project_phase);

      v_requirement_position := 0;
      for v_check in select value from jsonb_array_elements(v_step->'checks') loop
        v_requirement_position := v_requirement_position + 1;
        insert into bob.project_plan_requirements
          (project_id,plan_revision,requirement_id,step_id,position,requirement_type,title,description,
           resolution,responsible_kind,responsible_person_id,evidence_selector)
        values
          (v_project,v_revision,gen_random_uuid(),v_step_id,v_requirement_position,
           v_check->>0,v_check->>1,v_check->>2,'open',v_check->>3,null,
           '{"kind":"none","id":null,"subject":null,"area_id":null}'::jsonb);
      end loop;
    end loop;
    if v_position <> (v_plan->>'expected_steps')::integer or v_focus_step_id is null then
      raise exception 'living_plan_backfill: step count mismatch for %', v_project;
    end if;

    -- Tasks check plan.current_revision when linked, so activate the complete
    -- Step set before assigning the existing Tasks; all in one transaction.
    update bob.project_plans
    set current_revision=v_revision,next_revision=v_revision+1,
        focus_step_id=v_focus_step_id,updated_at=clock_timestamp()
    where project_id=v_project;

    v_position := 0;
    for v_step in select value from jsonb_array_elements(v_plan->'steps') loop
      v_position := v_position + 1;
      select step_id into strict v_step_id from bob.project_plan_steps
      where project_id=v_project and plan_revision=v_revision and position=v_position;
      v_task_position := 0;
      for v_task_id in select value from jsonb_array_elements_text(coalesce(v_step->'task_ids','[]'::jsonb)) loop
        v_task_position := v_task_position + 1;
        v_expected_tasks := v_expected_tasks + 1;
        select updated_at,area_id,primary_step_id
          into v_task_stamp,v_task_area,v_previous_step
        from bob.tasks where project_id=v_project and id=v_task_id for update;
        if not found or v_previous_step is not null or v_task_area is distinct from v_area then
          raise exception 'living_plan_backfill: Task baseline changed for % / %',v_project,v_task_id;
        end if;
        if exists (select 1 from jsonb_array_elements(v_task_links) l where l->>'task_id'=v_task_id) then
          raise exception 'living_plan_backfill: duplicate Task link for %',v_task_id;
        end if;
        v_task_links := v_task_links || jsonb_build_array(jsonb_build_object(
          'task_id',v_task_id,'step_id',v_step_id,'expected_updated_at',v_task_stamp
        ));
        insert into bob.project_plan_step_tasks(project_id,step_id,task_id,position,linked_by)
        values(v_project,v_step_id,v_task_id,v_task_position,v_owner);
        update bob.tasks set primary_step_id=v_step_id where project_id=v_project and id=v_task_id;
      end loop;
    end loop;
    select count(*) into v_actual_tasks from bob.tasks where project_id=v_project;
    if v_actual_tasks <> v_expected_tasks then
      raise exception 'living_plan_backfill: unmapped or unexpected Tasks for % (existing %, planned %)',
        v_project,v_actual_tasks,v_expected_tasks;
    end if;
    update bob.project_plan_revisions set task_links=v_task_links
    where project_id=v_project and revision=v_revision;

    if (select count(*) from bob.project_plan_steps
        where project_id=v_project and plan_revision=v_revision and state='active')<>1
      or (select count(*) from bob.project_plan_requirements
        where project_id=v_project and plan_revision=v_revision and resolution<>'open')<>0
      or (select count(*) from bob.project_plan_step_tasks where project_id=v_project)<>v_expected_tasks
    then
      raise exception 'living_plan_backfill: final invariant failed for %',v_project;
    end if;
  end loop;
end
$backfill$;
