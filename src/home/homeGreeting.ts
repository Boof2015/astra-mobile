export type HomeGreetingTextMode = 'messages' | 'clock' | 'off';
export type HomeGreetingBucket = 'morning' | 'afternoon' | 'evening' | 'late-night';

export interface HomeGreetingCopy {
  id: string;
  primary: string;
  subline: string;
}

export interface HomeGreetingSelection extends HomeGreetingCopy {
  bucket: HomeGreetingBucket;
}

interface TimeGreetingWindow {
  startMinute: number;
  endMinute: number;
  messages: readonly HomeGreetingCopy[];
}

interface WeightedGreetingPool {
  messages: readonly HomeGreetingCopy[];
  weight: number;
}

export const HOME_GREETING_ROTATION_MS = 30 * 60 * 1000;

const GREETING_WEIGHT_TIME_AWARE = 0.4;
const GREETING_WEIGHT_DAY_AWARE = 0.28;
const GREETING_WEIGHT_PLAYFUL = 0.32;

export const HOME_PLAYFUL_GREETINGS: readonly HomeGreetingCopy[] = [
  { id: 'playful-back-again', primary: 'Back again.', subline: 'Your music missed you.' },
  { id: 'playful-silence', primary: 'Silence?', subline: 'Nuh uh.' },
  { id: 'playful-aux', primary: 'The aux is yours.', subline: 'Don\'t mess this up.' },
  { id: 'playful-no-algorithm', primary: 'No algorithm.', subline: 'Just you.' },
  { id: 'playful-headphones', primary: 'Headphones on.', subline: 'World off.' },
  { id: 'playful-one-more', primary: 'One more song.', subline: 'Famous last words.' },
  { id: 'playful-tiny-screen', primary: 'Tiny screen.', subline: 'Big library.' },
  { id: 'playful-shuffle', primary: 'Shuffle responsibly.', subline: 'Or don\'t.' },
  { id: 'playful-queue', primary: 'Your queue called.', subline: 'It has concerns.' },
  { id: 'playful-local-files', primary: 'Local files.', subline: 'Radical concept, apparently.' },
  { id: 'playful-airplane', primary: 'Airplane mode?', subline: 'Still works.' },
  { id: 'playful-portable', primary: 'Now portable.', subline: 'Please don\'t drop me.' },
  { id: 'playful-hey', primary: 'hey…', subline: 'does anyone even read these?' },
  { id: 'playful-pocket', primary: 'I fit in your pocket now.', subline: 'This was a mistake.' },
  { id: 'playful-rectangle', primary: 'This rectangle demands music.', subline: 'Obey.' },
];

const TIME_AWARE_GREETINGS: readonly TimeGreetingWindow[] = [
  {
    startMinute: 0,
    endMinute: 180,
    messages: [{ id: 'time-midnight', primary: 'Still up?', subline: 'Go to sleep.' }],
  },
  {
    startMinute: 180,
    endMinute: 300,
    messages: [{ id: 'time-three-am', primary: '3 AM again, huh', subline: 'The void has music in it.' }],
  },
  {
    startMinute: 300,
    endMinute: 420,
    messages: [{ id: 'time-early-morning', primary: 'Morning.', subline: 'It\'s too early.' }],
  },
  {
    startMinute: 420,
    endMinute: 660,
    messages: [{ id: 'time-morning', primary: 'Good morning!', subline: 'Pick a soundtrack.' }],
  },
  {
    startMinute: 660,
    endMinute: 720,
    messages: [{ id: 'time-late-morning', primary: 'Late morning.', subline: 'Coffee acquired?' }],
  },
  {
    startMinute: 720,
    endMinute: 840,
    messages: [{ id: 'time-early-afternoon', primary: 'Good afternoon.', subline: 'Halfway there.' }],
  },
  {
    startMinute: 840,
    endMinute: 1020,
    messages: [{ id: 'time-afternoon', primary: 'Afternoon stretch.', subline: 'One more push.' }],
  },
  {
    startMinute: 1020,
    endMinute: 1080,
    messages: [{ id: 'time-sunset', primary: 'Sunset switch.', subline: 'Set the evening tone.' }],
  },
  {
    startMinute: 1080,
    endMinute: 1380,
    messages: [{ id: 'time-evening', primary: 'Good evening.', subline: 'The night is yours.' }],
  },
  {
    startMinute: 1380,
    endMinute: 1440,
    messages: [{ id: 'time-late-night', primary: 'Late night?', subline: 'Same.' }],
  },
];

export function parseHomeGreetingTextMode(value: string | null): HomeGreetingTextMode {
  return value === 'clock' || value === 'off' ? value : 'messages';
}

export function getHomeGreetingBucket(date: Date): HomeGreetingBucket {
  const hour = date.getHours();
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 17) return 'afternoon';
  if (hour >= 18 && hour <= 22) return 'evening';
  return 'late-night';
}

export function getTimeAwareGreetings(date: Date): readonly HomeGreetingCopy[] {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  return TIME_AWARE_GREETINGS.find(
    (entry) => minuteOfDay >= entry.startMinute && minuteOfDay < entry.endMinute
  )?.messages ?? [];
}

export function getDayAwareGreetings(date: Date): readonly HomeGreetingCopy[] {
  switch (date.getDay()) {
    case 1:
      return [{ id: 'day-monday', primary: 'Monday.', subline: 'Let\'s fix that.' }];
    case 3:
      return [{ id: 'day-wednesday', primary: 'It\'s Wednesday somehow.', subline: '' }];
    case 5:
      return [{ id: 'day-friday', primary: 'It\'s Friday.', subline: 'You made it.' }];
    case 0:
      return [{ id: 'day-sunday', primary: 'Sunday already?', subline: 'Put something good on.' }];
    default:
      return [];
  }
}

function boundedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

function pickRandomGreeting(
  messages: readonly HomeGreetingCopy[],
  previousId: string | null,
  random: () => number
): HomeGreetingCopy {
  const candidates = previousId
    ? messages.filter((message) => message.id !== previousId)
    : messages;
  const pool = candidates.length > 0 ? candidates : messages;
  return pool[Math.floor(boundedRandom(random) * pool.length)] ?? HOME_PLAYFUL_GREETINGS[0];
}

function pickWeightedGreetingPool(
  pools: readonly WeightedGreetingPool[],
  random: () => number
): WeightedGreetingPool {
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);
  let threshold = boundedRandom(random) * totalWeight;
  for (const pool of pools) {
    threshold -= pool.weight;
    if (threshold <= 0) return pool;
  }
  return pools[pools.length - 1];
}

export function chooseHomeGreeting(
  previousId: string | null,
  now: Date,
  random: () => number = Math.random
): HomeGreetingSelection {
  const timeAware = getTimeAwareGreetings(now);
  const dayAware = getDayAwareGreetings(now);
  const pools: WeightedGreetingPool[] = [
    { messages: timeAware, weight: GREETING_WEIGHT_TIME_AWARE },
    ...(dayAware.length > 0
      ? [{ messages: dayAware, weight: GREETING_WEIGHT_DAY_AWARE }]
      : []),
    { messages: HOME_PLAYFUL_GREETINGS, weight: GREETING_WEIGHT_PLAYFUL },
  ];

  const selectedPool = pickWeightedGreetingPool(pools, random);
  let greeting = pickRandomGreeting(selectedPool.messages, previousId, random);

  if (previousId && greeting.id === previousId) {
    const alternatives = pools
      .flatMap((pool) => pool.messages)
      .filter((candidate) => candidate.id !== previousId);
    if (alternatives.length > 0) {
      greeting = pickRandomGreeting(alternatives, previousId, random);
    }
  }

  return { ...greeting, bucket: getHomeGreetingBucket(now) };
}
