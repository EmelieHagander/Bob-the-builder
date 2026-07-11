/*
 * Seed / mock data for bob.
 *
 * This is the *only* file that hard-codes sample content. It exists so the app
 * runs end-to-end with no backend. The database layer (`database.ts`) reads from
 * here today; when a real backend is wired up, this file can be deleted or kept
 * purely for tests — nothing outside `database.ts` imports it.
 *
 * Content mirrors the "Skogsstuga" cabin build from the original mockup.
 */

import type {
  Account,
  AccountNote,
  Announcement,
  Area,
  BuildEvent,
  ChatMessage,
  DietMatrixRow,
  FoodGroup,
  Material,
  Meal,
  Person,
  Project,
  Task,
  TodayTask,
} from './types'

/*
 * The account level: all projects the crew has going. Skogsstuga is the one
 * with full sample content below; the other two exist so the account
 * dashboard and calendar have something real to show. The arrays are mutable
 * on purpose — in mock mode the database layer writes to them in-memory, so
 * demo changes behave like real ones until the page reloads.
 */
export const projects: Project[] = [
  {
    id: 'p_skogsstuga',
    slug: 'skogsstuga',
    name: 'Skogsstuga',
    description: 'A hand-built cabin in the Dalarna woods, raised by friends over a summer of build weekends.',
    location: 'Dalarna, Sweden',
    type: 'Cabin / stuga',
    theme: 'birch',
    startLabel: 'Sat 5 Jul',
    startDate: '2026-07-05',
    endDate: '2026-08-15',
  },
  {
    id: 'p_vaxthuset',
    slug: 'vaxthuset',
    name: 'Växthuset',
    description: 'A greenhouse built from recycled windows, going up next to the vegetable beds in one long weekend push.',
    location: 'Dalarna, Sweden',
    type: 'Greenhouse',
    theme: 'forest',
    startLabel: 'Sat 12 Sep',
    startDate: '2026-09-12',
    endDate: '2026-09-20',
  },
  {
    id: 'p_bastun',
    slug: 'bastun',
    name: 'Bastun',
    description: 'The lakeside sauna — finished this spring, first löyly already thrown.',
    location: 'Dalarna, Sweden',
    type: 'Sauna',
    theme: 'dusk',
    startLabel: 'Sat 2 May',
    startDate: '2026-05-02',
    endDate: '2026-05-24',
  },
]

export const account: Account = {
  id: 'account',
  name: 'Skogsfolket',
  ownerName: 'Emelie Karlsson',
  email: 'emelie@skogsfolket.se',
}

export const accountNotes: AccountNote[] = [
  {
    id: 'note_scaffolding',
    text: "Ask Henrik's cousin about borrowing the scaffolding again for Växthuset.",
    pinned: true,
    createdAt: '2026-07-08T09:15:00Z',
  },
  {
    id: 'note_byggmax',
    text: 'Byggmax has 20% off screws and fittings until the end of July — stock up for both builds.',
    pinned: false,
    createdAt: '2026-07-06T18:40:00Z',
  },
  {
    id: 'note_photos',
    text: 'Photos from the Bastun build are in the shared album — pick a few for the winter recap.',
    pinned: false,
    createdAt: '2026-06-28T20:05:00Z',
  },
]

export const people: Person[] = [
  {
    id: 'em',
    name: 'Emelie Karlsson',
    initials: 'EM',
    color: '#7E9B52',
    role: 'Organiser',
    skills: [
      { name: 'Carpentry', level: 'expert' },
      { name: 'Planning', level: 'expert' },
    ],
    diet: 'No restrictions',
  },
  {
    id: 'he',
    name: 'Henrik Lund',
    initials: 'HE',
    color: '#5E87A6',
    role: 'Crew lead · Taket',
    skills: [
      { name: 'Carpentry', level: 'expert' },
      { name: 'Roofing', level: 'intermediate' },
    ],
    diet: 'Vegetarian',
  },
  {
    id: 'as',
    name: 'Astrid Berg',
    initials: 'AS',
    color: '#B5675A',
    role: 'Crew lead · Bastun',
    skills: [{ name: 'Electrics', level: 'expert' }],
    diet: 'Gluten-free',
  },
  {
    id: 'ma',
    name: 'Maja Holm',
    initials: 'MA',
    color: '#C98B2E',
    role: 'Volunteer',
    skills: [
      { name: 'Painting', level: 'intermediate' },
      { name: 'General', level: 'novice' },
    ],
    diet: 'Nut allergy',
  },
  {
    id: 'la',
    name: 'Lars Ek',
    initials: 'LA',
    color: '#8A6FA8',
    role: 'Volunteer',
    skills: [{ name: 'Plumbing', level: 'intermediate' }],
    diet: 'No restrictions',
  },
  {
    id: 'si',
    name: 'Sigrid Nyström',
    initials: 'SI',
    color: '#B07F4F',
    role: 'Volunteer',
    skills: [
      { name: 'Driving', level: 'expert' },
      { name: 'General', level: 'novice' },
    ],
    diet: 'Vegan · dairy-free',
  },
  {
    id: 'os',
    name: 'Oskar Falk',
    initials: 'OS',
    color: '#5E9C68',
    role: 'Crew lead · Verandan',
    skills: [{ name: 'Carpentry', level: 'intermediate' }],
    diet: 'No restrictions',
  },
  {
    id: 'tv',
    name: 'Tomas Vik',
    initials: 'TV',
    color: '#C07A4E',
    role: 'Drop-in volunteer',
    skills: [{ name: 'General', level: 'novice' }],
    diet: 'Gluten-free',
  },
]

export const areas: Area[] = [
  {
    id: 'a_koket',
    slug: 'koket',
    name: 'Köket',
    description: 'The kitchen — heart of the cabin.',
    icon: 'cooking-pot',
    leadId: 'em',
    assignedPct: 80,
    materialsPct: 65,
    donePct: 40,
    taskSummary: '6 tasks · 2 need a skilled hand',
    crewIds: ['em', 'he', 'ma', 'la', 'si'],
    referenceImages: [{ label: 'oak flooring' }, { label: 'wall panel' }, { label: 'worktop finish' }],
  },
  {
    id: 'a_taket',
    slug: 'taket',
    name: 'Taket',
    description: 'The roof — battens, underlay and the ridge beam.',
    icon: 'house-line',
    leadId: 'he',
    assignedPct: 100,
    materialsPct: 90,
    donePct: 70,
    taskSummary: '6 tasks · on track',
    crewIds: ['he', 'si', 'tv'],
    referenceImages: [{ label: 'roof pitch' }, { label: 'ridge detail' }],
  },
  {
    id: 'a_bastun',
    slug: 'bastun',
    name: 'Bastun',
    description: 'The sauna — cladding, benches and the wiring.',
    icon: 'fire',
    leadId: 'as',
    assignedPct: 50,
    materialsPct: 30,
    donePct: 10,
    taskSummary: '7 tasks · waiting on the door',
    crewIds: ['as', 'la'],
    referenceImages: [{ label: 'cedar cladding' }, { label: 'bench layout' }],
  },
  {
    id: 'a_tradgarden',
    slug: 'tradgarden',
    name: 'Trädgården',
    description: 'The garden — beds, paths and planting.',
    icon: 'plant',
    leadId: 'ma',
    assignedPct: 40,
    materialsPct: 55,
    donePct: 25,
    taskSummary: '5 tasks · easy-going',
    crewIds: ['ma', 'tv'],
    referenceImages: [{ label: 'path stone' }],
  },
  {
    id: 'a_loftet',
    slug: 'loftet',
    name: 'Loftet',
    description: 'The loft — stairs, floor and the railing.',
    icon: 'stairs',
    leadId: 'la',
    assignedPct: 20,
    materialsPct: 10,
    donePct: 0,
    taskSummary: '4 tasks · not started yet',
    crewIds: ['la'],
    referenceImages: [],
  },
  {
    id: 'a_verandan',
    slug: 'verandan',
    name: 'Verandan',
    description: 'The porch — decking, rails and a coat of linseed oil.',
    icon: 'park',
    leadId: 'os',
    assignedPct: 90,
    materialsPct: 70,
    donePct: 55,
    taskSummary: '5 tasks · nearly there',
    crewIds: ['os', 'si'],
    referenceImages: [{ label: 'deck board' }, { label: 'rail profile' }],
  },
]

export const tasks: Task[] = [
  // Köket
  { id: 't_k1', areaId: 'a_koket', name: 'Tile the splashback', skill: 'expert', hours: '6h', status: 'blocked', assigneeIds: [], materials: '2 / 4' },
  { id: 't_k2', areaId: 'a_koket', name: 'Fit the base cabinets', skill: 'intermediate', hours: '4h', status: 'doing', assigneeIds: ['he', 'la'], materials: '4 / 4' },
  { id: 't_k3', areaId: 'a_koket', name: 'Paint walls — 2 coats', skill: 'novice', hours: '5h', status: 'doing', assigneeIds: ['ma'], materials: '3 / 3' },
  { id: 't_k4', areaId: 'a_koket', name: 'Install the worktop', skill: 'expert', hours: '3h', status: 'todo', assigneeIds: ['he'], materials: '1 / 2' },
  { id: 't_k5', areaId: 'a_koket', name: 'Sand & oil window frames', skill: 'novice', hours: '2h', status: 'done', assigneeIds: ['si'], materials: '2 / 2' },
  { id: 't_k6', areaId: 'a_koket', name: 'Under-cabinet lighting', skill: 'expert', hours: '3h', status: 'todo', assigneeIds: [], materials: '0 / 3' },
  // Taket
  { id: 't_t1', areaId: 'a_taket', name: 'Set the ridge beam', skill: 'expert', hours: '2h', status: 'todo', assigneeIds: ['he'], materials: '1 / 1' },
  { id: 't_t2', areaId: 'a_taket', name: 'Fit the roof battens', skill: 'intermediate', hours: '3h', status: 'doing', assigneeIds: ['he', 'si'], materials: '2 / 2' },
  { id: 't_t3', areaId: 'a_taket', name: 'Lay underlay membrane', skill: 'novice', hours: '1h', status: 'todo', assigneeIds: ['tv'], materials: '1 / 1' },
  // Bastun
  { id: 't_b1', areaId: 'a_bastun', name: 'Clad the walls', skill: 'intermediate', hours: '6h', status: 'blocked', assigneeIds: ['as'], materials: '1 / 3' },
  { id: 't_b2', areaId: 'a_bastun', name: 'Build the benches', skill: 'novice', hours: '4h', status: 'todo', assigneeIds: [], materials: '2 / 2' },
  { id: 't_b3', areaId: 'a_bastun', name: 'Wire the heater', skill: 'expert', hours: '3h', status: 'todo', assigneeIds: ['as'], materials: '0 / 2' },
  // Trädgården
  { id: 't_g1', areaId: 'a_tradgarden', name: 'Lay the path stones', skill: 'novice', hours: '4h', status: 'doing', assigneeIds: ['ma', 'tv'], materials: '1 / 1' },
  { id: 't_g2', areaId: 'a_tradgarden', name: 'Build raised beds', skill: 'intermediate', hours: '3h', status: 'todo', assigneeIds: [], materials: '1 / 2' },
  // Loftet
  { id: 't_l1', areaId: 'a_loftet', name: 'Build the loft stairs', skill: 'expert', hours: '8h', status: 'todo', assigneeIds: ['la'], materials: '0 / 3' },
  { id: 't_l2', areaId: 'a_loftet', name: 'Lay the loft floor', skill: 'intermediate', hours: '5h', status: 'todo', assigneeIds: [], materials: '0 / 2' },
  // Verandan
  { id: 't_v1', areaId: 'a_verandan', name: 'Oil the decking', skill: 'novice', hours: '3h', status: 'doing', assigneeIds: ['os'], materials: '1 / 1' },
  { id: 't_v2', areaId: 'a_verandan', name: 'Fit the handrail', skill: 'intermediate', hours: '3h', status: 'done', assigneeIds: ['os', 'si'], materials: '2 / 2' },
]

export const materials: Material[] = [
  { id: 'm1', name: 'Pine board 22×95mm', qty: '48 st', area: 'Köket', supplier: 'Beijer', status: 'delivered', cost: '1 920 kr', category: 'Timber', categoryIcon: 'tree' },
  { id: 'm2', name: 'OSB sheet 12mm', qty: '10 ark', area: 'Taket', supplier: 'Beijer', status: 'ordered', cost: '2 100 kr', category: 'Timber', categoryIcon: 'tree' },
  { id: 'm3', name: 'Glulam beam 90×270', qty: '3 st', area: 'Taket', supplier: 'Moelven', status: 'needed', cost: '4 350 kr', category: 'Timber', categoryIcon: 'tree' },
  { id: 'm4', name: 'Decking screws 4.5×60', qty: '5 box', area: 'Verandan', supplier: 'Beijer', status: 'delivered', cost: '650 kr', category: 'Fasteners & glue', categoryIcon: 'nut' },
  { id: 'm5', name: 'Wood glue 750ml', qty: '4 st', area: 'Several', supplier: 'Beijer', status: 'needed', cost: '320 kr', category: 'Fasteners & glue', categoryIcon: 'nut' },
  { id: 'm6', name: 'LED strip warm 3000K', qty: '8 m', area: 'Köket', supplier: 'Elgiganten', status: 'needed', cost: '960 kr', category: 'Electrical', categoryIcon: 'lightning' },
  { id: 'm7', name: 'Junction box IP44', qty: '6 st', area: 'Bastun', supplier: 'Elgiganten', status: 'ordered', cost: '540 kr', category: 'Electrical', categoryIcon: 'lightning' },
  { id: 'm8', name: 'Linseed paint — forest green', qty: '5 L', area: 'Verandan', supplier: 'Ottosson', status: 'delivered', cost: '1 750 kr', category: 'Paint & finish', categoryIcon: 'paint-roller' },
  { id: 'm9', name: 'Tile adhesive 25kg', qty: '2 säck', area: 'Köket', supplier: 'Beijer', status: 'needed', cost: '460 kr', category: 'Paint & finish', categoryIcon: 'paint-roller' },
  { id: 'm10', name: 'Sauna door — glass', qty: '1 st', area: 'Bastun', supplier: 'Tylö', status: 'backorder', cost: '3 200 kr', category: 'Sauna & plumbing', categoryIcon: 'drop' },
  { id: 'm11', name: 'Mixer tap', qty: '1 st', area: 'Köket', supplier: 'Bauhaus', status: 'ordered', cost: '1 290 kr', category: 'Sauna & plumbing', categoryIcon: 'drop' },
]

export const events: BuildEvent[] = [
  {
    id: 'e_rabygge',
    slug: 'rabygge',
    title: 'Råbygge — walls & roof',
    day: 'Lör 5 juli',
    time: '09:00–16:00',
    place: 'Skogsstuga, Dalarna',
    spots: '12 / 20',
    status: 'going',
    attendeeIds: ['em', 'he', 'as', 'ma', 'la', 'si', 'os', 'tv'],
    food: 'Lunch 12:30 — köttbullar & potatis (veg + GF sorted) · Fika 15:00',
  },
  {
    id: 'e_sauna',
    slug: 'sauna-cladding',
    title: 'Sauna cladding day',
    day: 'Sön 13 juli',
    time: '10:00–15:00',
    place: 'Skogsstuga, Dalarna',
    spots: '4 / 8',
    status: 'open',
    attendeeIds: ['as', 'la', 'em', 'os'],
    food: 'Lunch: soppa & smörgås (GF bread set aside)',
  },
  {
    id: 'e_garden',
    slug: 'garden-porch',
    title: 'Garden & porch finish',
    day: 'Lör 26 juli',
    time: '09:00–14:00',
    place: 'Skogsstuga, Dalarna',
    spots: '2 / 10',
    status: 'open',
    attendeeIds: ['ma', 'os'],
    food: 'Grilllunch by the porch',
  },
]

/** Meals for the next build day (Råbygge). */
export const meals: Meal[] = [
  { id: 'meal_b', meal: 'Breakfast', time: '07:30', icon: 'coffee', dish: 'Gröt, fil & frukt', notes: 'Oats, lingon, strong coffee' },
  { id: 'meal_l', meal: 'Lunch', time: '12:30', icon: 'cooking-pot', dish: 'Köttbullar & potatis', notes: 'Veg: halloumi · GF gravy set aside' },
  { id: 'meal_f', meal: 'Fika', time: '15:00', icon: 'cookie', dish: 'Kanelbullar', notes: 'Astrid is baking — keep nut-free' },
  { id: 'meal_d', meal: 'Dinner', time: '18:00', icon: 'fire', dish: 'Korv & bröd vid elden', notes: '3 GF buns reserved' },
]

export const dietColumns = ['Vegetarian', 'Vegan', 'Gluten-free', 'Nut allergy', 'Dairy-free']

export const dietMatrix: DietMatrixRow[] = [
  { personId: 'em', flags: [false, false, false, false, false] },
  { personId: 'he', flags: [true, false, false, false, false] },
  { personId: 'as', flags: [false, false, true, false, false] },
  { personId: 'ma', flags: [false, false, false, true, false] },
  { personId: 'la', flags: [false, false, false, false, false] },
  { personId: 'si', flags: [true, true, false, false, true] },
  { personId: 'os', flags: [false, false, false, false, false] },
  { personId: 'tv', flags: [false, false, true, false, false] },
]

export const announcements: Announcement[] = [
  {
    id: 'an1',
    authorId: 'em',
    time: '2h ago',
    pinned: true,
    text: 'Timber trailer lands Friday 7am — Henrik, can you meet it at the gate? Bring the tractor if the track is muddy.',
    reacts: 5,
    comments: 3,
  },
  {
    id: 'an2',
    authorId: 'em',
    time: '2 days ago',
    pinned: true,
    text: 'Saturday plan: walls in the morning, roof after lunch. Lunch is 12:30 by the barn. Park along the north fence, please.',
    reacts: 9,
    comments: 2,
  },
  {
    id: 'an3',
    authorId: 'as',
    time: 'Yesterday',
    pinned: false,
    text: 'Sauna door is back-ordered ~2 weeks. I marked the cladding task as blocked so nobody starts it early.',
    reacts: 2,
    comments: 4,
  },
  {
    id: 'an4',
    authorId: 'ma',
    time: '3 days ago',
    pinned: false,
    text: 'Bringing extra wheelbarrows and the good coffee. Shout if anyone needs wet-weather gear.',
    reacts: 7,
    comments: 1,
  },
  {
    id: 'an5',
    authorId: 'os',
    time: '4 days ago',
    pinned: false,
    text: 'Porch decking is basically done — come and admire it. Just the oiling left now.',
    reacts: 11,
    comments: 5,
  },
]

export const foodShopping: FoodGroup[] = [
  {
    category: 'Fresh & veg',
    icon: 'carrot',
    items: [
      { name: 'Potatis', qty: '4 kg', note: '', checked: true },
      { name: 'Gul lök', qty: '1 kg', note: '', checked: true },
      { name: 'Sallad & gurka', qty: '3 påsar', note: '', checked: false },
      { name: 'Lingonsylt', qty: '500 g', note: '', checked: false },
    ],
  },
  {
    category: 'Meat & dairy',
    icon: 'cow',
    items: [
      { name: 'Köttfärs', qty: '3 kg', note: '', checked: true },
      { name: 'Halloumi', qty: '1.5 kg', note: 'veg main · serves 3', checked: false },
      { name: 'Grädde', qty: '1 L', note: '', checked: false },
      { name: 'Smör', qty: '500 g', note: '', checked: true },
    ],
  },
  {
    category: 'Bread & dry',
    icon: 'bread',
    items: [
      { name: 'Tunnbröd', qty: '4 paket', note: '3 GF set aside', checked: false },
      { name: 'Bulldeg (kanelbullar)', qty: '24 st', note: 'keep nut-free', checked: false },
      { name: 'Kaffe', qty: '1 kg', note: '', checked: true },
    ],
  },
  {
    category: 'Drinks',
    icon: 'coffee',
    items: [
      { name: 'Mjölk', qty: '3 L', note: '+ havremjölk 1 L', checked: false },
      { name: 'Saft', qty: '2 L', note: '', checked: true },
    ],
  },
]

/** "My tasks today" — the day-of view for the next build day. */
export const todayTasks: TodayTask[] = [
  { id: 'td1', areaName: 'Taket', name: 'Set the ridge beam', skill: 'expert', status: 'todo', assigneeIds: ['he'] },
  { id: 'td2', areaName: 'Taket', name: 'Fit the roof battens', skill: 'intermediate', status: 'doing', assigneeIds: ['he', 'si'] },
  { id: 'td3', areaName: 'Köket', name: 'Fit the base cabinets', skill: 'intermediate', status: 'doing', assigneeIds: ['la'] },
  { id: 'td4', areaName: 'Köket', name: 'Paint walls — 2 coats', skill: 'novice', status: 'doing', assigneeIds: ['ma'] },
  { id: 'td5', areaName: 'Verandan', name: 'Oil the decking', skill: 'novice', status: 'todo', assigneeIds: ['os'] },
]

/** Scripted "Ask bob" conversation from the mockup. */
export const askBobChat: ChatMessage[] = [
  {
    from: 'bob',
    text: "Hej Emelie! I've got the whole Skogsstuga build in my head — ask me anything. Or I can flag what still needs sorting before Saturday.",
  },
  { from: 'user', text: 'What still needs sorting before Saturday?' },
  {
    from: 'bob',
    text: "Three things I'd nudge before the big day:",
    list: [
      { icon: 'user-circle-dashed', tone: 'clay', text: "3 roof tasks have nobody assigned — Henrik's crew is a bit light." },
      { icon: 'package', tone: 'honey', text: 'The sauna door is back-ordered, so the cladding task is blocked.' },
      { icon: 'medal', tone: 'clay', text: "Kitchen tiling needs a skilled tiler. Astrid's confirmed and qualified." },
    ],
    action: 'Assign Astrid to the tiling',
    note: "Heads-up: there's 1 nut allergy on Saturday — the kanelbullar need to stay nut-free.",
  },
  { from: 'user', text: 'Yes please, assign her. Who can do the plumbing?' },
  {
    from: 'bob',
    text: "Done — Astrid's on the splashback tiling. For plumbing you've got Lars (intermediate) confirmed, and Sigrid can assist. The two open jobs are the kitchen sink and the sauna floor drain. Want me to pencil them in?",
  },
]

export const askBobChips = ["What's blocking us?", "Who's free Saturday?", 'Plan a chicken coop', 'Draft an announcement']
