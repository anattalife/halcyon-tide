// HALCYON TIDE — deterministic identities: names, nationalities, persona flavour and bark lines.
// Everything here is original text. Identity generation is pure (seed → same person every time),
// so other systems (pickpocketing, missions, dialogue) can rely on it.
import { Rng } from '../core/util.js';

// Nationality flavour: [id, label, weight, given-name pool key, family-name pool key, currency-ish spend factor]
export const NATIONALITIES = [
  ['uk', 'British', 9, 'anglo', 'anglo', 1.0],
  ['us', 'American', 12, 'us', 'us', 1.15],
  ['ca', 'Canadian', 4, 'us', 'anglo', 1.0],
  ['au', 'Australian', 4, 'anglo', 'anglo', 1.0],
  ['ie', 'Irish', 2, 'irish', 'irish', 0.95],
  ['de', 'German', 6, 'german', 'german', 1.05],
  ['nl', 'Dutch', 2, 'dutch', 'dutch', 1.0],
  ['fr', 'French', 4, 'french', 'french', 1.0],
  ['it', 'Italian', 4, 'italian', 'italian', 0.95],
  ['es', 'Spanish', 4, 'spanish', 'spanish', 0.9],
  ['mx', 'Mexican', 3, 'spanish', 'spanish', 0.85],
  ['br', 'Brazilian', 3, 'portuguese', 'portuguese', 0.85],
  ['pt', 'Portuguese', 1, 'portuguese', 'portuguese', 0.85],
  ['se', 'Swedish', 2, 'nordic', 'nordic', 1.1],
  ['no', 'Norwegian', 1, 'nordic', 'nordic', 1.2],
  ['pl', 'Polish', 2, 'slavic', 'polish', 0.8],
  ['jp', 'Japanese', 3, 'japanese', 'japanese', 1.1],
  ['kr', 'Korean', 2, 'korean', 'korean', 1.05],
  ['cn', 'Chinese', 4, 'chinese', 'chinese', 1.1],
  ['in', 'Indian', 4, 'indian', 'indian', 0.95],
  ['ng', 'Nigerian', 2, 'nigerian', 'nigerian', 1.0],
  ['za', 'South African', 1, 'anglo', 'afrikaans', 0.9],
  ['gh', 'Ghanaian', 1, 'ghanaian', 'ghanaian', 0.9],
  ['eg', 'Egyptian', 1, 'arabic', 'arabic', 0.9],
  ['ae', 'Emirati', 1, 'arabic', 'arabic', 2.2],
  ['tr', 'Turkish', 1, 'turkish', 'turkish', 0.85],
  ['ph', 'Filipino', 2, 'filipino', 'filipino', 0.8],
  ['gr', 'Greek', 1, 'greek', 'greek', 0.9],
];
// Crew are drawn from a different mix (heavily international hotel department).
const CREW_NAT = { ph: 10, in: 8, id: 0, uk: 4, it: 4, ua: 0, pl: 3, gr: 2, us: 2, de: 2, nl: 2, za: 2, br: 2, mx: 2, ng: 1, gh: 1, se: 1, no: 2, tr: 1, es: 2, pt: 2, jp: 1, kr: 1, cn: 1, fr: 1, ie: 1, au: 1, ca: 1, eg: 1, ae: 0 };

const G = {
  anglo: { m: ['Oliver', 'Harry', 'George', 'Jack', 'Arthur', 'Theo', 'Freddie', 'Alfie', 'Edward', 'Callum', 'Rhys', 'Owen', 'Graham', 'Nigel', 'Martin', 'Simon', 'Duncan', 'Stuart', 'Toby', 'Rupert'],
    f: ['Amelia', 'Isla', 'Poppy', 'Florence', 'Imogen', 'Harriet', 'Beatrice', 'Rosie', 'Lucy', 'Fiona', 'Gemma', 'Hayley', 'Philippa', 'Jessica', 'Megan', 'Sian', 'Kirsty', 'Joanne', 'Clare', 'Bethan'] },
  us: { m: ['Mason', 'Logan', 'Tyler', 'Brandon', 'Cody', 'Dustin', 'Garrett', 'Wyatt', 'Carter', 'Hunter', 'Darnell', 'Marcus', 'Trevor', 'Bryce', 'Chase', 'Dwayne', 'Russell', 'Clint', 'Jerome', 'Kyle'],
    f: ['Madison', 'Brooke', 'Kayla', 'Savannah', 'Taylor', 'Morgan', 'Destiny', 'Haley', 'Courtney', 'Shelby', 'Jasmine', 'Tamika', 'Brittany', 'Paige', 'Kendra', 'Lacey', 'Dana', 'Tonya', 'Whitney', 'Autumn'] },
  irish: { m: ['Cian', 'Oisin', 'Darragh', 'Padraig', 'Ronan', 'Eoin', 'Fionn', 'Declan', 'Cathal', 'Senan'], f: ['Aoife', 'Niamh', 'Saoirse', 'Siobhan', 'Orla', 'Roisin', 'Clodagh', 'Grainne', 'Ciara', 'Maeve'] },
  german: { m: ['Lukas', 'Jonas', 'Felix', 'Maximilian', 'Tobias', 'Matthias', 'Jürgen', 'Dieter', 'Florian', 'Henrik', 'Kai', 'Uwe'], f: ['Lena', 'Hannah', 'Leonie', 'Annika', 'Katrin', 'Sabine', 'Ute', 'Mareike', 'Johanna', 'Friederike', 'Svenja', 'Birgit'] },
  dutch: { m: ['Daan', 'Sem', 'Bram', 'Thijs', 'Joris', 'Wouter', 'Ruud', 'Pieter'], f: ['Sanne', 'Femke', 'Lotte', 'Anouk', 'Marieke', 'Ilse', 'Fleur', 'Noor'] },
  french: { m: ['Hugo', 'Louis', 'Mathis', 'Théo', 'Baptiste', 'Julien', 'Mathieu', 'Olivier', 'Rémi', 'Yannick', 'Gaël'], f: ['Léa', 'Chloé', 'Manon', 'Camille', 'Inès', 'Elodie', 'Margaux', 'Céline', 'Aurélie', 'Solène', 'Juliette'] },
  italian: { m: ['Lorenzo', 'Matteo', 'Alessandro', 'Davide', 'Federico', 'Giorgio', 'Stefano', 'Massimo', 'Riccardo', 'Gianluca'], f: ['Giulia', 'Chiara', 'Francesca', 'Sofia', 'Martina', 'Alessia', 'Valentina', 'Serena', 'Ilaria', 'Beatrice'] },
  spanish: { m: ['Mateo', 'Diego', 'Javier', 'Alejandro', 'Sergio', 'Pablo', 'Rodrigo', 'Joaquín', 'Iker', 'Emilio', 'Raúl'], f: ['Lucía', 'Valeria', 'Ximena', 'Paula', 'Carmen', 'Alba', 'Marisol', 'Nerea', 'Itzel', 'Rocío', 'Pilar'] },
  portuguese: { m: ['João', 'Thiago', 'Rafael', 'Gustavo', 'Bruno', 'Caio', 'Henrique', 'Vinícius', 'Rui', 'Tiago'], f: ['Beatriz', 'Larissa', 'Camila', 'Mariana', 'Fernanda', 'Inês', 'Raquel', 'Luana', 'Joana', 'Bianca'] },
  nordic: { m: ['Erik', 'Lars', 'Magnus', 'Nils', 'Oskar', 'Sindre', 'Anders', 'Bjørn', 'Henrik', 'Leif'], f: ['Astrid', 'Freja', 'Ingrid', 'Linnea', 'Maja', 'Sigrid', 'Elin', 'Tove', 'Karin', 'Signe'] },
  slavic: { m: ['Jakub', 'Kacper', 'Piotr', 'Tomasz', 'Marek', 'Bartosz', 'Wojciech', 'Paweł'], f: ['Zofia', 'Natalia', 'Agnieszka', 'Kasia', 'Magdalena', 'Ewa', 'Dorota', 'Joanna'] },
  japanese: { m: ['Haruto', 'Ren', 'Sota', 'Takumi', 'Kenji', 'Daiki', 'Hiroshi', 'Yuto', 'Shun', 'Kazuki'], f: ['Yui', 'Aoi', 'Hina', 'Sakura', 'Mei', 'Ayaka', 'Haruka', 'Rin', 'Nanami', 'Emi'] },
  korean: { m: ['Minjun', 'Seojun', 'Jiho', 'Hyunwoo', 'Dohyun', 'Jaewon', 'Sungmin', 'Taeyang'], f: ['Seoyeon', 'Jiwoo', 'Minseo', 'Haeun', 'Yuna', 'Soyeon', 'Eunji', 'Dahye'] },
  chinese: { m: ['Wei', 'Hao', 'Jun', 'Ming', 'Zhiyuan', 'Yichen', 'Haoran', 'Bowen', 'Lei', 'Tao'], f: ['Mei', 'Xinyi', 'Yutong', 'Jing', 'Lan', 'Ruoxi', 'Shuang', 'Qian', 'Lin', 'Yan'] },
  indian: { m: ['Arjun', 'Rohan', 'Vikram', 'Aarav', 'Karthik', 'Siddharth', 'Rahul', 'Anand', 'Pranav', 'Nikhil'], f: ['Priya', 'Ananya', 'Kavya', 'Divya', 'Meera', 'Ishita', 'Lakshmi', 'Neha', 'Shreya', 'Pooja'] },
  nigerian: { m: ['Chinedu', 'Emeka', 'Tunde', 'Oluwaseun', 'Ifeanyi', 'Babatunde', 'Obinna', 'Kelechi'], f: ['Ngozi', 'Chiamaka', 'Folake', 'Adaeze', 'Yetunde', 'Ifeoma', 'Funmilayo', 'Amaka'] },
  ghanaian: { m: ['Kwame', 'Kofi', 'Yaw', 'Kwabena', 'Kojo', 'Fiifi'], f: ['Akosua', 'Ama', 'Efua', 'Abena', 'Adwoa', 'Esi'] },
  arabic: { m: ['Omar', 'Youssef', 'Karim', 'Tariq', 'Hamza', 'Khalid', 'Rami', 'Faisal'], f: ['Layla', 'Nour', 'Yasmin', 'Salma', 'Mariam', 'Rania', 'Hana', 'Dalia'] },
  turkish: { m: ['Emir', 'Burak', 'Kerem', 'Mert', 'Can', 'Onur'], f: ['Elif', 'Zeynep', 'Defne', 'Ece', 'Selin', 'Aylin'] },
  filipino: { m: ['Jomar', 'Rodel', 'Marvin', 'Arnel', 'Jericho', 'Rommel', 'Dante', 'Noel', 'Ramil', 'Ariel'], f: ['Maricel', 'Rowena', 'Jhoanna', 'Liezl', 'Rosalie', 'Kristine', 'Mylene', 'Analyn', 'Charmaine', 'Grace'] },
  greek: { m: ['Nikos', 'Giorgos', 'Kostas', 'Dimitris', 'Yannis', 'Stavros'], f: ['Eleni', 'Katerina', 'Dimitra', 'Sofia', 'Ioanna', 'Despina'] },
};
const F = {
  anglo: ['Ashworth', 'Pemberton', 'Hollis', 'Thornbury', 'Garside', 'Whitlock', 'Fairbairn', 'Hendry', 'Bramley', 'Calloway', 'Dunmore', 'Ellwood', 'Fenwick', 'Gilmour', 'Hartigan', 'Kettering', 'Lockridge', 'Merriweather', 'Norbury', 'Oakden', 'Pryce', 'Radcliffe', 'Seddon', 'Tavener', 'Underhill', 'Vickery', 'Wainwright', 'Yardley'],
  us: ['Delacroix', 'Brannigan', 'Coltrane', 'Easterly', 'Fairfax', 'Granger', 'Holloway', 'Jennings', 'Kowalczyk', 'Lindqvist', 'McAllister', 'Okafor', 'Prescott', 'Quinlan', 'Redmond', 'Sandoval', 'Thibodeaux', 'Vance', 'Washburn', 'Yancey', 'Zimmerman', 'Booker', 'Castellano', 'Dupree'],
  irish: ['Ó Briain', 'Mac Giolla', 'Keane', 'Doherty', 'Flanagan', 'Gallagher', 'Mulcahy', 'Nolan', 'Brennan', 'Cassidy'],
  german: ['Achterberg', 'Brandauer', 'Eichhorn', 'Falkenrath', 'Grünewald', 'Hartmann', 'Kessler', 'Lindemann', 'Mertens', 'Ostermann', 'Reinholdt', 'Steinbach', 'Vogt', 'Weidner'],
  dutch: ['van Dijkhuis', 'de Groot', 'Bosman', 'Hoekstra', 'Kuipers', 'van der Meulen', 'Visser', 'Brouwer'],
  french: ['Abelard', 'Beaumarchais', 'Chastain', 'Delorme', 'Fontaine', 'Giraud', 'Lacombe', 'Marchetti', 'Rousseau', 'Vasseur', 'Morel', 'Leclerc'],
  italian: ['Albertini', 'Bellucci', 'Caravaggi', 'De Santis', 'Ferraro', 'Galletti', 'Lombardo', 'Moretti', 'Pellegrini', 'Rinaldi', 'Sartori', 'Vitale'],
  spanish: ['Aguilar', 'Barrientos', 'Cárdenas', 'Domínguez', 'Escobedo', 'Figueroa', 'Galindo', 'Herrera', 'Ibarra', 'Medina', 'Navarro', 'Ortega', 'Quiroga', 'Salazar', 'Valdés'],
  portuguese: ['Almeida', 'Bettencourt', 'Carvalho', 'Duarte', 'Esteves', 'Figueiredo', 'Magalhães', 'Nogueira', 'Rocha', 'Teixeira'],
  nordic: ['Ahlgren', 'Bergstrand', 'Dahlberg', 'Ekström', 'Haugland', 'Lindgren', 'Nyberg', 'Sandvik', 'Solberg', 'Vikström'],
  polish: ['Andrzejewski', 'Borkowski', 'Czarnecka', 'Dąbrowski', 'Jabłoński', 'Kaczmarek', 'Lewandowska', 'Nowicki', 'Wiśniewski', 'Zielińska'],
  japanese: ['Aoyama', 'Fujimoto', 'Hayashida', 'Ishikawa', 'Kobayashi', 'Matsuda', 'Nakamura', 'Ogawa', 'Sakamoto', 'Takeda', 'Yamaguchi'],
  korean: ['Baek', 'Choi', 'Han', 'Jang', 'Kang', 'Lim', 'Moon', 'Seo', 'Yoon'],
  chinese: ['Chen', 'Guo', 'Huang', 'Liang', 'Luo', 'Song', 'Tang', 'Xu', 'Zhao', 'Zheng'],
  indian: ['Agarwal', 'Banerjee', 'Chatterjee', 'Desai', 'Iyer', 'Kapoor', 'Menon', 'Nair', 'Pillai', 'Reddy', 'Srinivasan', 'Venkataraman'],
  nigerian: ['Adebayo', 'Chukwu', 'Eze', 'Nwosu', 'Okonkwo', 'Olawale', 'Onyeka', 'Uzoma'],
  afrikaans: ['Botha', 'du Plessis', 'Erasmus', 'Joubert', 'Kruger', 'Steyn', 'van Wyk', 'Venter'],
  ghanaian: ['Asante', 'Boateng', 'Mensah', 'Owusu', 'Appiah', 'Darko'],
  arabic: ['Al-Hashimi', 'Haddad', 'Khoury', 'Mansour', 'Nasser', 'Saleh', 'Farouk', 'Aziz'],
  turkish: ['Aydın', 'Demir', 'Kaya', 'Öztürk', 'Şahin', 'Yıldız'],
  filipino: ['Bautista', 'Dela Cruz', 'Garcia', 'Macaraeg', 'Santos', 'Villanueva', 'Pascual', 'Ramos', 'Tolentino', 'Manalo'],
  greek: ['Andreou', 'Georgiou', 'Konstantinidis', 'Papadakis', 'Stavrou', 'Vlachos'],
};

const NAT_BY_ID = Object.fromEntries(NATIONALITIES.map(n => [n[0], n]));

export function pickNationality(rng, crew = false) {
  if (crew) {
    const ent = Object.entries(CREW_NAT).filter(e => e[1] > 0 && NAT_BY_ID[e[0]]);
    return NAT_BY_ID[rng.weighted(ent)];
  }
  return rng.weighted(NATIONALITIES.map(n => [n, n[2]]));
}

export function makeName(rng, sex, nat) {
  const gp = G[nat[3]] || G.anglo, fp = F[nat[4]] || F.anglo;
  const first = rng.pick(sex === 'f' ? gp.f : gp.m);
  const last = rng.pick(fp);
  return { first, last, full: first + ' ' + last };
}

const TRAITS = ['wealthy', 'drunk', 'nervous', 'curious', 'friendly', 'rude'];
const VALUABLES = [
  ['wristwatch', 120, 9000], ['smartphone', 300, 1400], ['necklace', 80, 12000], ['camera', 250, 3000],
  ['earrings', 60, 4000], ['tablet', 200, 1100], ['casino chips', 25, 2500], ['cufflinks', 40, 1500], ['designer sunglasses', 90, 600],
];

// Full deterministic identity for an ambient or crew NPC.
//   opts: { crew, role, sex, age, cabins (array of pax cabins), crewCabins }
export function makeIdentity(seed, opts = {}) {
  const rng = new Rng(seed >>> 0 || 1);
  const crew = !!opts.crew;
  const nat = pickNationality(rng, crew);
  const sex = opts.sex || (rng.chance(0.5) ? 'm' : 'f');
  const name = makeName(rng, sex, nat);
  const age = opts.age || 'adult';
  const years = age === 'child' ? rng.int(5, 12) : age === 'elderly' ? rng.int(66, 88) : crew ? rng.int(21, 58) : rng.int(19, 64);
  const persona = {};
  for (const t of TRAITS) persona[t] = false;
  if (!crew && age !== 'child') {
    persona.wealthy = rng.chance(0.14 * (nat[5] > 1.5 ? 3 : 1));
    persona.drunk = rng.chance(0.08);
    persona.nervous = rng.chance(0.12);
    persona.curious = rng.chance(0.2);
    persona.friendly = rng.chance(0.35);
    persona.rude = !persona.friendly && rng.chance(0.12);
  } else if (crew) {
    persona.friendly = rng.chance(0.6); persona.nervous = rng.chance(0.08); persona.curious = rng.chance(0.15);
  } else { persona.curious = rng.chance(0.6); persona.nervous = rng.chance(0.2); }
  // wallet: log-normal-ish
  const base = age === 'child' ? rng.range(0, 25) : Math.exp(rng.range(Math.log(20), Math.log(crew ? 260 : 700)));
  const cash = Math.round(base * (persona.wealthy ? rng.range(3, 9) : 1) * nat[5]);
  const valuables = [];
  if (age !== 'child') {
    const n = persona.wealthy ? rng.int(1, 3) : rng.chance(0.55) ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const v = rng.pick(VALUABLES);
      if (valuables.some(x => x.item === v[0])) continue;
      const value = Math.round(rng.range(v[1], persona.wealthy ? v[2] : v[1] * 4));
      valuables.push({ item: v[0], value });
    }
  }
  let cabin = null;
  if (crew && opts.crewCabins?.length) cabin = opts.crewCabins[Math.floor(rng.next() * opts.crewCabins.length)].no;
  else if (!crew && opts.cabins?.length) cabin = opts.cabins[Math.floor(rng.next() * opts.cabins.length)].no;
  const voice = { sex, pitch: +(age === 'child' ? rng.range(1.35, 1.6) : age === 'elderly' ? rng.range(0.8, 0.98) : sex === 'f' ? rng.range(1.05, 1.3) : rng.range(0.78, 1.0)).toFixed(2), rate: +rng.range(0.92, 1.12).toFixed(2) };
  return {
    seed, name: name.full, first: name.first, last: name.last, sex, age, years, nationality: nat[1], natId: nat[0],
    persona, cash, valuables, cabin, voice, keycard: crew ? 'crew' : cabin ? `cabin:${cabin}` : null,
  };
}

// ── Bark lines ─────────────────────────────────────────────────────────────
// Keyed by context. Short, original, ship-appropriate.
export const BARKS = {
  transit: ['Which way is the forward lift?', 'I swear this corridor was shorter yesterday.', 'Has anyone seen the towel animals?', 'We\'re on the wrong side again.', 'Starboard is right, isn\'t it?', 'Did you pack the sun cream?', 'Let\'s grab a coffee first.', 'My cabin card stopped working again.', 'Is it formal night tonight?', 'Ooh, smell that sea air.', 'I think we\'re lost.', 'Mum, can we go to the pool?'],
  dining: ['Table for two, please.', 'Could we get some more bread?', 'I\'ll have the sea bass.', 'This is the best soufflé I\'ve ever had.', 'Is the dessert menu out yet?', 'Cheers, to the open sea!', 'Do you think they\'d do a half portion?', 'Not the lobster again, darling.'],
  buffet: ['They\'ve got the waffles back!', 'Grab me a plate, would you?', 'I\'m only having fruit. And maybe a pastry.', 'Is this the queue for the omelettes?', 'Don\'t take the last croissant.'],
  bar: ['Same again, please.', 'What do you recommend?', 'Make it a double.', 'Put it on the cabin, thanks.', 'Have you tried the house special?', 'To the captain!', 'Is it happy hour yet?'],
  club: ['I love this song!', 'Come on, dance with me!', 'It\'s too loud in here!', 'One more and then bed.', 'Where did everyone go?'],
  casino: ['Come on, lucky seven!', 'I\'m up forty. Quitting while I\'m ahead.', 'Hit me.', 'Red. It\'s always red.', 'Don\'t tell your mother.', 'One more spin.'],
  pool: ['The water\'s lovely once you\'re in!', 'Save me a lounger!', 'Did you bring the good towels?', 'I\'m going to burn, aren\'t I?', 'Watch me do a cannonball!', 'This is the life.'],
  theater: ['Shh, it\'s starting.', 'I hope it\'s the magician again.', 'These seats are perfect.', 'Bravo!', 'Can you see past that hat?'],
  shop: ['It\'s cheaper duty-free, apparently.', 'Do you have this in blue?', 'Just browsing, thanks.', 'That watch costs more than our cabin.'],
  view: ['Look, dolphins!', 'Smile, darling.', 'You can see for miles.', 'Is that land over there?', 'Get one with the sunset.'],
  lounge: ['Shall we play cards later?', 'I could fall asleep right here.', 'This book is getting good.'],
  gym: ['Just five more minutes.', 'Who set the treadmill to uphill?'],
  spa: ['Bliss.', 'I booked the hot stone massage.'],
  kids: ['Again! Again!', 'I\'m on the blue team!'],
  greet: ['Lovely day for it.', 'Morning!', 'Evening.', 'Hello there.', 'Enjoying the cruise?'],
  // crew
  housekeeping: ['Housekeeping!', 'Fresh towels for you.', 'I\'ll come back later.', 'Room service, good morning.'],
  waiter: ['Excuse me, hot plates.', 'Coming through!', 'Anything else for the table?', 'Your starters, madam.', 'Behind you.'],
  bartender: ['What can I get you?', 'Coming right up.', 'Ice?', 'Enjoy your evening.'],
  dealer: ['Place your bets.', 'No more bets.', 'Dealer has nineteen.', 'Good luck.'],
  clerk: ['How can I help?', 'Next guest, please.', 'Just a moment.', 'Welcome aboard.'],
  security: ['Keep it moving, folks.', 'All quiet on deck.', 'Copy that.', 'Evening. Everything all right?', 'Please don\'t run.'],
  crew: ['Shift change in ten.', 'Has anyone seen the chief?', 'Mess is serving curry tonight.', 'Did you get your roster?', 'Two more weeks, then home.'],
  cook: ['Service!', 'Two sea bass, one steak, medium!', 'Hands!', 'Where\'s my garnish?'],
  deckhand: ['Mind the wet deck.', 'Careful, it\'s slippery here.'],
  // reactions
  bump: ['Hey, watch it!', 'Excuse you!', 'Oi!', 'Do you mind?', 'Careful!', 'Rude.', 'Ow, my foot!', 'Some people...'],
  bumpPolite: ['Oh, sorry!', 'Pardon me.', 'Whoops.', 'Excuse me.'],
  scream: ['Help!', 'Oh my God!', 'Run!', 'Somebody call security!', 'Get down!'],
  body: ['Is... is he breathing?', 'Somebody help! There\'s a body!', 'Call the medic!', 'Oh no, oh no...'],
  calm: ['What was that?', 'Is it over?', 'I need a drink.'],
};

export function pickBark(rng, ctx) {
  const l = BARKS[ctx] || BARKS.transit;
  return l[Math.floor(rng() * l.length)];
}
