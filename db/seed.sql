-- ─────────────────────────────────────────────────────────────────────────────
-- bob — seed data (the "Skogsstuga" sample project)
--
-- Mirrors src/data/mockData.ts row for row, using the same ids, so the app
-- behaves identically whether it reads the mock module or the database.
-- Idempotent: safe to re-run (`on conflict do nothing` everywhere).
--
-- Apply with:  psql "$DATABASE_URL" -f db/seed.sql
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────── project ───────────────

insert into bob.projects (id, slug, name, description, location, type, theme, start_label) values
  ('p_skogsstuga', 'skogsstuga', 'Skogsstuga',
   'A hand-built cabin in the Dalarna woods, raised by friends over a summer of build weekends.',
   'Dalarna, Sweden', 'Cabin / stuga', 'birch', 'Sat 5 Jul')
on conflict (id) do nothing;

-- ─────────────── people ───────────────

insert into bob.people (id, project_id, name, initials, color, role, diet) values
  ('em', 'p_skogsstuga', 'Emelie Karlsson', 'EM', '#7E9B52', 'Organiser',            'No restrictions'),
  ('he', 'p_skogsstuga', 'Henrik Lund',     'HE', '#5E87A6', 'Crew lead · Taket',    'Vegetarian'),
  ('as', 'p_skogsstuga', 'Astrid Berg',     'AS', '#B5675A', 'Crew lead · Bastun',   'Gluten-free'),
  ('ma', 'p_skogsstuga', 'Maja Holm',       'MA', '#C98B2E', 'Volunteer',            'Nut allergy'),
  ('la', 'p_skogsstuga', 'Lars Ek',         'LA', '#8A6FA8', 'Volunteer',            'No restrictions'),
  ('si', 'p_skogsstuga', 'Sigrid Nyström',  'SI', '#B07F4F', 'Volunteer',            'Vegan · dairy-free'),
  ('os', 'p_skogsstuga', 'Oskar Falk',      'OS', '#5E9C68', 'Crew lead · Verandan', 'No restrictions'),
  ('tv', 'p_skogsstuga', 'Tomas Vik',       'TV', '#C07A4E', 'Drop-in volunteer',    'Gluten-free')
on conflict (id) do nothing;

insert into bob.person_skills (person_id, name, level) values
  ('em', 'Carpentry', 'expert'),
  ('em', 'Planning',  'expert'),
  ('he', 'Carpentry', 'expert'),
  ('he', 'Roofing',   'intermediate'),
  ('as', 'Electrics', 'expert'),
  ('ma', 'Painting',  'intermediate'),
  ('ma', 'General',   'novice'),
  ('la', 'Plumbing',  'intermediate'),
  ('si', 'Driving',   'expert'),
  ('si', 'General',   'novice'),
  ('os', 'Carpentry', 'intermediate'),
  ('tv', 'General',   'novice')
on conflict do nothing;

-- ─────────────── areas ───────────────

insert into bob.areas (id, project_id, slug, name, description, icon, lead_id,
                       assigned_pct, materials_pct, done_pct, task_summary) values
  ('a_koket',      'p_skogsstuga', 'koket',      'Köket',      'The kitchen — heart of the cabin.',                       'cooking-pot', 'em',  80, 65, 40, '6 tasks · 2 need a skilled hand'),
  ('a_taket',      'p_skogsstuga', 'taket',      'Taket',      'The roof — battens, underlay and the ridge beam.',        'house-line',  'he', 100, 90, 70, '6 tasks · on track'),
  ('a_bastun',     'p_skogsstuga', 'bastun',     'Bastun',     'The sauna — cladding, benches and the wiring.',           'fire',        'as',  50, 30, 10, '7 tasks · waiting on the door'),
  ('a_tradgarden', 'p_skogsstuga', 'tradgarden', 'Trädgården', 'The garden — beds, paths and planting.',                  'plant',       'ma',  40, 55, 25, '5 tasks · easy-going'),
  ('a_loftet',     'p_skogsstuga', 'loftet',     'Loftet',     'The loft — stairs, floor and the railing.',               'stairs',      'la',  20, 10,  0, '4 tasks · not started yet'),
  ('a_verandan',   'p_skogsstuga', 'verandan',   'Verandan',   'The porch — decking, rails and a coat of linseed oil.',   'park',        'os',  90, 70, 55, '5 tasks · nearly there')
on conflict (id) do nothing;

insert into bob.area_crew (area_id, person_id) values
  ('a_koket', 'em'), ('a_koket', 'he'), ('a_koket', 'ma'), ('a_koket', 'la'), ('a_koket', 'si'),
  ('a_taket', 'he'), ('a_taket', 'si'), ('a_taket', 'tv'),
  ('a_bastun', 'as'), ('a_bastun', 'la'),
  ('a_tradgarden', 'ma'), ('a_tradgarden', 'tv'),
  ('a_loftet', 'la'),
  ('a_verandan', 'os'), ('a_verandan', 'si')
on conflict do nothing;

insert into bob.area_reference_images (area_id, label, sort_order)
select v.area_id, v.label, v.sort_order
from (values
  ('a_koket',      'oak flooring',   0),
  ('a_koket',      'wall panel',     1),
  ('a_koket',      'worktop finish', 2),
  ('a_taket',      'roof pitch',     0),
  ('a_taket',      'ridge detail',   1),
  ('a_bastun',     'cedar cladding', 0),
  ('a_bastun',     'bench layout',   1),
  ('a_tradgarden', 'path stone',     0),
  ('a_verandan',   'deck board',     0),
  ('a_verandan',   'rail profile',   1)
) as v(area_id, label, sort_order)
where not exists (
  select 1 from bob.area_reference_images r
  where r.area_id = v.area_id and r.label = v.label
);

-- ─────────────── tasks ───────────────

insert into bob.tasks (id, area_id, name, skill, hours, status, materials) values
  ('t_k1', 'a_koket',      'Tile the splashback',        'expert',       '6h', 'blocked', '2 / 4'),
  ('t_k2', 'a_koket',      'Fit the base cabinets',      'intermediate', '4h', 'doing',   '4 / 4'),
  ('t_k3', 'a_koket',      'Paint walls — 2 coats',      'novice',       '5h', 'doing',   '3 / 3'),
  ('t_k4', 'a_koket',      'Install the worktop',        'expert',       '3h', 'todo',    '1 / 2'),
  ('t_k5', 'a_koket',      'Sand & oil window frames',   'novice',       '2h', 'done',    '2 / 2'),
  ('t_k6', 'a_koket',      'Under-cabinet lighting',     'expert',       '3h', 'todo',    '0 / 3'),
  ('t_t1', 'a_taket',      'Set the ridge beam',         'expert',       '2h', 'todo',    '1 / 1'),
  ('t_t2', 'a_taket',      'Fit the roof battens',       'intermediate', '3h', 'doing',   '2 / 2'),
  ('t_t3', 'a_taket',      'Lay underlay membrane',      'novice',       '1h', 'todo',    '1 / 1'),
  ('t_b1', 'a_bastun',     'Clad the walls',             'intermediate', '6h', 'blocked', '1 / 3'),
  ('t_b2', 'a_bastun',     'Build the benches',          'novice',       '4h', 'todo',    '2 / 2'),
  ('t_b3', 'a_bastun',     'Wire the heater',            'expert',       '3h', 'todo',    '0 / 2'),
  ('t_g1', 'a_tradgarden', 'Lay the path stones',        'novice',       '4h', 'doing',   '1 / 1'),
  ('t_g2', 'a_tradgarden', 'Build raised beds',          'intermediate', '3h', 'todo',    '1 / 2'),
  ('t_l1', 'a_loftet',     'Build the loft stairs',      'expert',       '8h', 'todo',    '0 / 3'),
  ('t_l2', 'a_loftet',     'Lay the loft floor',         'intermediate', '5h', 'todo',    '0 / 2'),
  ('t_v1', 'a_verandan',   'Oil the decking',            'novice',       '3h', 'doing',   '1 / 1'),
  ('t_v2', 'a_verandan',   'Fit the handrail',           'intermediate', '3h', 'done',    '2 / 2')
on conflict (id) do nothing;

insert into bob.task_assignees (task_id, person_id) values
  ('t_k2', 'he'), ('t_k2', 'la'),
  ('t_k3', 'ma'),
  ('t_k4', 'he'),
  ('t_k5', 'si'),
  ('t_t1', 'he'),
  ('t_t2', 'he'), ('t_t2', 'si'),
  ('t_t3', 'tv'),
  ('t_b1', 'as'),
  ('t_b3', 'as'),
  ('t_g1', 'ma'), ('t_g1', 'tv'),
  ('t_l1', 'la'),
  ('t_v1', 'os'),
  ('t_v2', 'os'), ('t_v2', 'si')
on conflict do nothing;

-- ─────────────── materials ───────────────

insert into bob.materials (id, project_id, name, qty, area_label, supplier, status, cost, category, category_icon, sort_order) values
  ('m1',  'p_skogsstuga', 'Pine board 22×95mm',          '48 st',  'Köket',    'Beijer',     'delivered', '1 920 kr', 'Timber',            'tree',         1),
  ('m2',  'p_skogsstuga', 'OSB sheet 12mm',              '10 ark', 'Taket',    'Beijer',     'ordered',   '2 100 kr', 'Timber',            'tree',         2),
  ('m3',  'p_skogsstuga', 'Glulam beam 90×270',          '3 st',   'Taket',    'Moelven',    'needed',    '4 350 kr', 'Timber',            'tree',         3),
  ('m4',  'p_skogsstuga', 'Decking screws 4.5×60',       '5 box',  'Verandan', 'Beijer',     'delivered', '650 kr',   'Fasteners & glue',  'nut',          4),
  ('m5',  'p_skogsstuga', 'Wood glue 750ml',             '4 st',   'Several',  'Beijer',     'needed',    '320 kr',   'Fasteners & glue',  'nut',          5),
  ('m6',  'p_skogsstuga', 'LED strip warm 3000K',        '8 m',    'Köket',    'Elgiganten', 'needed',    '960 kr',   'Electrical',        'lightning',    6),
  ('m7',  'p_skogsstuga', 'Junction box IP44',           '6 st',   'Bastun',   'Elgiganten', 'ordered',   '540 kr',   'Electrical',        'lightning',    7),
  ('m8',  'p_skogsstuga', 'Linseed paint — forest green', '5 L',   'Verandan', 'Ottosson',   'delivered', '1 750 kr', 'Paint & finish',    'paint-roller', 8),
  ('m9',  'p_skogsstuga', 'Tile adhesive 25kg',          '2 säck', 'Köket',    'Beijer',     'needed',    '460 kr',   'Paint & finish',    'paint-roller', 9),
  ('m10', 'p_skogsstuga', 'Sauna door — glass',          '1 st',   'Bastun',   'Tylö',       'backorder', '3 200 kr', 'Sauna & plumbing',  'drop',        10),
  ('m11', 'p_skogsstuga', 'Mixer tap',                   '1 st',   'Köket',    'Bauhaus',    'ordered',   '1 290 kr', 'Sauna & plumbing',  'drop',        11)
on conflict (id) do nothing;

-- ─────────────── events ───────────────

insert into bob.events (id, project_id, slug, title, day, time, place, spots, status, food, sort_order) values
  ('e_rabygge', 'p_skogsstuga', 'rabygge',        'Råbygge — walls & roof',  'Lör 5 juli',  '09:00–16:00', 'Skogsstuga, Dalarna', '12 / 20', 'going',
   'Lunch 12:30 — köttbullar & potatis (veg + GF sorted) · Fika 15:00', 1),
  ('e_sauna',   'p_skogsstuga', 'sauna-cladding', 'Sauna cladding day',      'Sön 13 juli', '10:00–15:00', 'Skogsstuga, Dalarna', '4 / 8',   'open',
   'Lunch: soppa & smörgås (GF bread set aside)', 2),
  ('e_garden',  'p_skogsstuga', 'garden-porch',   'Garden & porch finish',   'Lör 26 juli', '09:00–14:00', 'Skogsstuga, Dalarna', '2 / 10',  'open',
   'Grilllunch by the porch', 3)
on conflict (id) do nothing;

insert into bob.event_attendees (event_id, person_id) values
  ('e_rabygge', 'em'), ('e_rabygge', 'he'), ('e_rabygge', 'as'), ('e_rabygge', 'ma'),
  ('e_rabygge', 'la'), ('e_rabygge', 'si'), ('e_rabygge', 'os'), ('e_rabygge', 'tv'),
  ('e_sauna', 'as'), ('e_sauna', 'la'), ('e_sauna', 'em'), ('e_sauna', 'os'),
  ('e_garden', 'ma'), ('e_garden', 'os')
on conflict do nothing;

-- ─────────────── food ───────────────

insert into bob.meals (id, project_id, event_id, meal, time, icon, dish, notes, sort_order) values
  ('meal_b', 'p_skogsstuga', 'e_rabygge', 'Breakfast', '07:30', 'coffee',      'Gröt, fil & frukt',       'Oats, lingon, strong coffee',            1),
  ('meal_l', 'p_skogsstuga', 'e_rabygge', 'Lunch',     '12:30', 'cooking-pot', 'Köttbullar & potatis',    'Veg: halloumi · GF gravy set aside',     2),
  ('meal_f', 'p_skogsstuga', 'e_rabygge', 'Fika',      '15:00', 'cookie',      'Kanelbullar',             'Astrid is baking — keep nut-free',       3),
  ('meal_d', 'p_skogsstuga', 'e_rabygge', 'Dinner',    '18:00', 'fire',        'Korv & bröd vid elden',   '3 GF buns reserved',                     4)
on conflict (id) do nothing;

insert into bob.diet_columns (id, project_id, name, sort_order) values
  ('dc_vegetarian', 'p_skogsstuga', 'Vegetarian',  1),
  ('dc_vegan',      'p_skogsstuga', 'Vegan',       2),
  ('dc_glutenfree', 'p_skogsstuga', 'Gluten-free', 3),
  ('dc_nutallergy', 'p_skogsstuga', 'Nut allergy', 4),
  ('dc_dairyfree',  'p_skogsstuga', 'Dairy-free',  5)
on conflict (id) do nothing;

insert into bob.diet_flags (person_id, column_id) values
  ('he', 'dc_vegetarian'),
  ('as', 'dc_glutenfree'),
  ('ma', 'dc_nutallergy'),
  ('si', 'dc_vegetarian'), ('si', 'dc_vegan'), ('si', 'dc_dairyfree'),
  ('tv', 'dc_glutenfree')
on conflict do nothing;

insert into bob.food_groups (id, project_id, category, icon, sort_order) values
  ('fg_fresh',  'p_skogsstuga', 'Fresh & veg',  'carrot', 1),
  ('fg_meat',   'p_skogsstuga', 'Meat & dairy', 'cow',    2),
  ('fg_bread',  'p_skogsstuga', 'Bread & dry',  'bread',  3),
  ('fg_drinks', 'p_skogsstuga', 'Drinks',       'coffee', 4)
on conflict (id) do nothing;

insert into bob.food_items (group_id, name, qty, note, checked, sort_order)
select v.group_id, v.name, v.qty, v.note, v.checked, v.sort_order
from (values
  ('fg_fresh',  'Potatis',                '4 kg',     '',                       true,  1),
  ('fg_fresh',  'Gul lök',                '1 kg',     '',                       true,  2),
  ('fg_fresh',  'Sallad & gurka',         '3 påsar',  '',                       false, 3),
  ('fg_fresh',  'Lingonsylt',             '500 g',    '',                       false, 4),
  ('fg_meat',   'Köttfärs',               '3 kg',     '',                       true,  1),
  ('fg_meat',   'Halloumi',               '1.5 kg',   'veg main · serves 3',    false, 2),
  ('fg_meat',   'Grädde',                 '1 L',      '',                       false, 3),
  ('fg_meat',   'Smör',                   '500 g',    '',                       true,  4),
  ('fg_bread',  'Tunnbröd',               '4 paket',  '3 GF set aside',         false, 1),
  ('fg_bread',  'Bulldeg (kanelbullar)',  '24 st',    'keep nut-free',          false, 2),
  ('fg_bread',  'Kaffe',                  '1 kg',     '',                       true,  3),
  ('fg_drinks', 'Mjölk',                  '3 L',      '+ havremjölk 1 L',       false, 1),
  ('fg_drinks', 'Saft',                   '2 L',      '',                       true,  2)
) as v(group_id, name, qty, note, checked, sort_order)
where not exists (
  select 1 from bob.food_items f
  where f.group_id = v.group_id and f.name = v.name
);

-- ─────────────── announcements ───────────────

insert into bob.announcements (id, project_id, author_id, time_label, pinned, text, reacts, comments) values
  ('an1', 'p_skogsstuga', 'em', '2h ago',     true,
   'Timber trailer lands Friday 7am — Henrik, can you meet it at the gate? Bring the tractor if the track is muddy.', 5, 3),
  ('an2', 'p_skogsstuga', 'em', '2 days ago', true,
   'Saturday plan: walls in the morning, roof after lunch. Lunch is 12:30 by the barn. Park along the north fence, please.', 9, 2),
  ('an3', 'p_skogsstuga', 'as', 'Yesterday',  false,
   'Sauna door is back-ordered ~2 weeks. I marked the cladding task as blocked so nobody starts it early.', 2, 4),
  ('an4', 'p_skogsstuga', 'ma', '3 days ago', false,
   'Bringing extra wheelbarrows and the good coffee. Shout if anyone needs wet-weather gear.', 7, 1),
  ('an5', 'p_skogsstuga', 'os', '4 days ago', false,
   'Porch decking is basically done — come and admire it. Just the oiling left now.', 11, 5)
on conflict (id) do nothing;

commit;
