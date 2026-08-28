/**
 * Graphics registry: module A5.
 *
 * Two kinds of graphics live here:
 *
 * 1. `badges`: hand-authored, FILL-based screen-print shapes (solid clipart,
 *    tight viewBoxes, geometry generated numerically). These lead the list.
 * 2. Curated stroke icons from the `lucide` package (ISC, see
 *    docs/credits/A5.md), serialized from lucide's IconNode data into
 *    self-contained `<svg>` strings with `stroke = color`, strokeWidth 2.
 *
 * Every id is stable + kebab-case; renderers may key caches on `id` + color.
 */
import type { GraphicDef } from '@/lib/types'
import type { IconNode } from 'lucide'
import {
  // sports
  Trophy, Medal, Award, Target, Goal, Volleyball, Bike, Motorbike, Dumbbell,
  BicepsFlexed, SportShoe, Timer, Kayak, Sailboat, FishingRod, ChessKnight,
  Swords,
  // music
  Music, Music2, Music4, Guitar, Piano, Drum, Mic, MicVocal, Headphones,
  Speaker, Radio, Disc3, CassetteTape, BoomBox, Turntable, AudioLines,
  KeyboardMusic,
  // animals
  PawPrint, Cat, Dog, Bird, Fish, FishSymbol, Rabbit, Turtle, Squirrel, Panda,
  Rat, Snail, Bug, Worm, Shrimp, Bone, Feather,
  // nature
  Mountain, MountainSnow, TreePine, TreePalm, TreeDeciduous, Leaf, Flower,
  Rose, Sprout, Clover, Sun, Moon, MoonStar, CloudLightning, Snowflake,
  Rainbow, Waves,
  // food
  Pizza, Hamburger, Coffee, CupSoda, IceCreamCone, Donut, CakeSlice,
  Croissant, Cookie, Candy, Apple, Cherry, Citrus, Banana, Carrot, Popcorn,
  ChefHat, UtensilsCrossed,
  // tech
  Rocket, Bot, Cpu, CircuitBoard, Gamepad2, Joystick, Camera, Drone,
  Satellite, SatelliteDish, Atom, FlaskConical, Microscope, Telescope,
  Lightbulb, QrCode, Terminal,
  // symbols
  Heart, Star, Sparkles, Zap, Flame, Crown, Anchor, Skull, Ghost, Gem, Spade,
  Club, Infinity as InfinityIcon, Smile, HandMetal, PartyPopper, Crosshair,
} from 'lucide'

export const GRAPHIC_CATEGORIES: { id: string; name: string }[] = [
  { id: 'badges', name: 'Badges' },
  { id: 'sports', name: 'Sports' },
  { id: 'music', name: 'Music' },
  { id: 'animals', name: 'Animals' },
  { id: 'nature', name: 'Nature' },
  { id: 'food', name: 'Food' },
  { id: 'tech', name: 'Tech' },
  { id: 'symbols', name: 'Symbols' },
]

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/** Minimal attribute-value escaping (lucide data is plain path/number data). */
function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/**
 * Serialize a lucide IconNode ([tag, attrs][]) into a complete standalone
 * `<svg>` string tinted via `stroke`. Matches lucide's own render defaults
 * (24×24 viewBox, strokeWidth 2, round caps/joins, no fill).
 */
function lucideSvg(node: IconNode, color: string): string {
  const inner = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
        .join('')
      return `<${tag}${a}/>`
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"` +
    ` stroke="${esc(color)}" stroke-width="2" stroke-linecap="round"` +
    ` stroke-linejoin="round">${inner}</svg>`
  )
}

/** Stroke icon sourced from lucide. Lucide art is square, so aspect = 1. */
function icon(id: string, name: string, category: string, node: IconNode): GraphicDef {
  return { id, name, category, aspect: 1, svg: (color) => lucideSvg(node, color) }
}

/**
 * Hand-authored solid print shape. `viewBox` is tight to the geometry
 * (+0.5 unit safety pad on every edge) and `aspect` equals its w/h.
 */
function fillBadge(
  id: string,
  name: string,
  aspect: number,
  viewBox: string,
  d: string,
  fillRule?: 'evenodd',
): GraphicDef {
  return {
    id,
    name,
    category: 'badges',
    aspect,
    svg: (color) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
      `<path${fillRule ? ` fill-rule="${fillRule}"` : ''} fill="${esc(color)}" d="${d}"/></svg>`,
  }
}

// ---------------------------------------------------------------------------
// Registry (badges first, then category order)
// ---------------------------------------------------------------------------

export const GRAPHICS: GraphicDef[] = [
  // -- badges: solid screen-print clipart ------------------------------------
  fillBadge('star-badge', 'Star', 1.05, '-48.05 -50.5 96.1 91.45',
    'M0 -50 L12.05 -16.58 L47.55 -15.45 L19.5 6.33 L29.39 40.45 L0 20.5 L-29.39 40.45 L-19.5 6.33 L-47.55 -15.45 L-12.05 -16.58 Z'),
  fillBadge('starburst-seal', 'Starburst seal', 1, '-50.5 -50.5 101 101',
    'M0 -50 Q5.36 -26.97 19.13 -46.19 Q15.28 -22.87 35.36 -35.36 Q22.87 -15.28 46.19 -19.13 Q26.97 -5.36 50 0 Q26.97 5.36 46.19 19.13 Q22.87 15.28 35.36 35.36 Q15.28 22.87 19.13 46.19 Q5.36 26.97 0 50 Q-5.36 26.97 -19.13 46.19 Q-15.28 22.87 -35.36 35.36 Q-22.87 15.28 -46.19 19.13 Q-26.97 5.36 -50 0 Q-26.97 -5.36 -46.19 -19.13 Q-22.87 -15.28 -35.36 -35.36 Q-15.28 -22.87 -19.13 -46.19 Q-5.36 -26.97 0 -50 Z'),
  fillBadge('ribbon-banner', 'Ribbon banner', 3.34, '-58.5 -17.5 117 35',
    'M-33 -17 L33 -17 L33 -9 L58 -9 L46 4 L58 17 L28 17 L33 9 L-33 9 L-28 17 L-58 17 L-48 4 L-58 -9 L-33 -9 Z'),
  fillBadge('shield-crest', 'Shield crest', 0.8, '-40.5 -50.5 81 101',
    'M-40 -50 L40 -50 L40 -14 C40 14 26 38 0 50 C-26 38 -40 14 -40 -14 Z M-33.6 -42 L33.6 -42 L33.6 -11.76 C33.6 11.76 21.84 31.92 0 42 C-21.84 31.92 -33.6 11.76 -33.6 -11.76 Z M-26.4 -33 L26.4 -33 L26.4 -9.24 C26.4 9.24 17.16 25.08 0 33 C-17.16 25.08 -26.4 9.24 -26.4 -9.24 Z',
    'evenodd'),
  fillBadge('varsity-arch', 'Varsity arch', 1.31, '-63.5 -58.5 127 97',
    'M-58 30 L-58 0 A58 58 0 0 1 58 0 L58 30 L40 30 L40 0 A40 40 0 0 0 -40 0 L-40 30 Z M-63 30 L-35 30 L-35 38 L-63 38 Z M35 30 L63 30 L63 38 L35 38 Z'),
  fillBadge('heart-solid', 'Heart', 1.05, '-40.5 19.5 81 77',
    'M0 34 C-3.2 26 -10 20 -18 20 C-30 20 -40 29 -40 43 C-40 61 -22 77 0 96 C22 77 40 61 40 43 C40 29 30 20 18 20 C10 20 3.2 26 0 34 Z'),
  fillBadge('lightning-solid', 'Lightning', 0.62, '-0.5 -0.5 63 101',
    'M60 0 L0 58 L30 58 L14 100 L62 40 L34 40 Z'),
  fillBadge('crown-solid', 'Crown', 1.37, '-51.5 -34.5 103 75',
    'M-45 -8 L-22 10 L0 -20 L22 10 L45 -8 L45 24 L-45 24 Z M-45 28 L45 28 L45 40 L-45 40 Z M-45 -22 C-41.69 -22 -39 -19.31 -39 -16 C-39 -12.69 -41.69 -10 -45 -10 C-48.31 -10 -51 -12.69 -51 -16 C-51 -19.31 -48.31 -22 -45 -22 Z M0 -34 C3.31 -34 6 -31.31 6 -28 C6 -24.69 3.31 -22 0 -22 C-3.31 -22 -6 -24.69 -6 -28 C-6 -31.31 -3.31 -34 0 -34 Z M45 -22 C48.31 -22 51 -19.31 51 -16 C51 -12.69 48.31 -10 45 -10 C41.69 -10 39 -12.69 39 -16 C39 -19.31 41.69 -22 45 -22 Z'),
  fillBadge('flame-solid', 'Flame', 0.66, '-32.84 -0.5 66.55 101',
    'M5 0 C7 15 -5 24 -14 35 C-27 50 -34 62 -32 74 C-29 91 -13 100 1 100 C17 100 31 90 33 74 C34.6 61 27 51 20 42 C14.5 34.5 11 26 12.5 16 C8.5 20.5 6 24.5 5.4 29 C1 20 2.5 9.5 5 0 Z M0.5 60 C-6.5 67 -11 72.5 -10.5 79 C-10 86.5 -4.5 91 1 91 C7.5 91 12.5 86 12 78.5 C11.5 71.5 7 66 0.5 60 Z',
    'evenodd'),

  // -- sports ----------------------------------------------------------------
  icon('trophy', 'Trophy', 'sports', Trophy),
  icon('medal', 'Medal', 'sports', Medal),
  icon('award-ribbon', 'Award ribbon', 'sports', Award),
  icon('target', 'Target', 'sports', Target),
  icon('goal-flag', 'Goal flag', 'sports', Goal),
  icon('volleyball', 'Volleyball', 'sports', Volleyball),
  icon('bike', 'Bicycle', 'sports', Bike),
  icon('motorbike', 'Motorbike', 'sports', Motorbike),
  icon('dumbbell', 'Dumbbell', 'sports', Dumbbell),
  icon('biceps', 'Biceps', 'sports', BicepsFlexed),
  icon('sport-shoe', 'Sneaker', 'sports', SportShoe),
  icon('stopwatch', 'Stopwatch', 'sports', Timer),
  icon('kayak', 'Kayak', 'sports', Kayak),
  icon('sailboat', 'Sailboat', 'sports', Sailboat),
  icon('fishing-rod', 'Fishing rod', 'sports', FishingRod),
  icon('chess-knight', 'Chess knight', 'sports', ChessKnight),
  icon('swords', 'Crossed swords', 'sports', Swords),

  // -- music -------------------------------------------------------------------
  icon('music', 'Music notes', 'music', Music),
  icon('music-note', 'Music note', 'music', Music2),
  icon('beamed-notes', 'Beamed notes', 'music', Music4),
  icon('guitar', 'Guitar', 'music', Guitar),
  icon('piano', 'Piano', 'music', Piano),
  icon('drum', 'Drum', 'music', Drum),
  icon('mic', 'Microphone', 'music', Mic),
  icon('mic-vocal', 'Vocal mic', 'music', MicVocal),
  icon('headphones', 'Headphones', 'music', Headphones),
  icon('speaker', 'Speaker', 'music', Speaker),
  icon('radio', 'Radio', 'music', Radio),
  icon('vinyl', 'Vinyl record', 'music', Disc3),
  icon('cassette', 'Cassette tape', 'music', CassetteTape),
  icon('boombox', 'Boombox', 'music', BoomBox),
  icon('turntable', 'Turntable', 'music', Turntable),
  icon('audio-lines', 'Sound wave', 'music', AudioLines),
  icon('keyboard-music', 'Synth keys', 'music', KeyboardMusic),

  // -- animals -----------------------------------------------------------------
  icon('paw-print', 'Paw print', 'animals', PawPrint),
  icon('cat', 'Cat', 'animals', Cat),
  icon('dog', 'Dog', 'animals', Dog),
  icon('bird', 'Bird', 'animals', Bird),
  icon('fish', 'Fish', 'animals', Fish),
  icon('fish-symbol', 'Fish symbol', 'animals', FishSymbol),
  icon('rabbit', 'Rabbit', 'animals', Rabbit),
  icon('turtle', 'Turtle', 'animals', Turtle),
  icon('squirrel', 'Squirrel', 'animals', Squirrel),
  icon('panda', 'Panda', 'animals', Panda),
  icon('rat', 'Rat', 'animals', Rat),
  icon('snail', 'Snail', 'animals', Snail),
  icon('bug', 'Beetle', 'animals', Bug),
  icon('worm', 'Worm', 'animals', Worm),
  icon('shrimp', 'Shrimp', 'animals', Shrimp),
  icon('bone', 'Bone', 'animals', Bone),
  icon('feather', 'Feather', 'animals', Feather),

  // -- nature ------------------------------------------------------------------
  icon('mountain', 'Mountain', 'nature', Mountain),
  icon('mountain-snow', 'Snowy mountain', 'nature', MountainSnow),
  icon('tree-pine', 'Pine tree', 'nature', TreePine),
  icon('tree-palm', 'Palm tree', 'nature', TreePalm),
  icon('tree', 'Tree', 'nature', TreeDeciduous),
  icon('leaf', 'Leaf', 'nature', Leaf),
  icon('flower', 'Flower', 'nature', Flower),
  icon('rose', 'Rose', 'nature', Rose),
  icon('sprout', 'Sprout', 'nature', Sprout),
  icon('clover', 'Clover', 'nature', Clover),
  icon('sun', 'Sun', 'nature', Sun),
  icon('moon', 'Moon', 'nature', Moon),
  icon('moon-star', 'Moon & star', 'nature', MoonStar),
  icon('storm-cloud', 'Storm cloud', 'nature', CloudLightning),
  icon('snowflake', 'Snowflake', 'nature', Snowflake),
  icon('rainbow', 'Rainbow', 'nature', Rainbow),
  icon('waves', 'Waves', 'nature', Waves),

  // -- food --------------------------------------------------------------------
  icon('pizza', 'Pizza slice', 'food', Pizza),
  icon('burger', 'Burger', 'food', Hamburger),
  icon('coffee', 'Coffee', 'food', Coffee),
  icon('soda', 'Soda cup', 'food', CupSoda),
  icon('ice-cream', 'Ice cream', 'food', IceCreamCone),
  icon('donut', 'Donut', 'food', Donut),
  icon('cake-slice', 'Cake slice', 'food', CakeSlice),
  icon('croissant', 'Croissant', 'food', Croissant),
  icon('cookie', 'Cookie', 'food', Cookie),
  icon('candy', 'Candy', 'food', Candy),
  icon('apple', 'Apple', 'food', Apple),
  icon('cherry', 'Cherry', 'food', Cherry),
  icon('citrus', 'Citrus', 'food', Citrus),
  icon('banana', 'Banana', 'food', Banana),
  icon('carrot', 'Carrot', 'food', Carrot),
  icon('popcorn', 'Popcorn', 'food', Popcorn),
  icon('chef-hat', 'Chef hat', 'food', ChefHat),
  icon('utensils', 'Crossed utensils', 'food', UtensilsCrossed),

  // -- tech --------------------------------------------------------------------
  icon('rocket', 'Rocket', 'tech', Rocket),
  icon('robot', 'Robot', 'tech', Bot),
  icon('cpu', 'CPU chip', 'tech', Cpu),
  icon('circuit-board', 'Circuit board', 'tech', CircuitBoard),
  icon('gamepad', 'Gamepad', 'tech', Gamepad2),
  icon('joystick', 'Joystick', 'tech', Joystick),
  icon('camera', 'Camera', 'tech', Camera),
  icon('drone', 'Drone', 'tech', Drone),
  icon('satellite', 'Satellite', 'tech', Satellite),
  icon('satellite-dish', 'Satellite dish', 'tech', SatelliteDish),
  icon('atom', 'Atom', 'tech', Atom),
  icon('flask', 'Flask', 'tech', FlaskConical),
  icon('microscope', 'Microscope', 'tech', Microscope),
  icon('telescope', 'Telescope', 'tech', Telescope),
  icon('lightbulb', 'Light bulb', 'tech', Lightbulb),
  icon('qr-code', 'QR code', 'tech', QrCode),
  icon('terminal', 'Terminal', 'tech', Terminal),

  // -- symbols -------------------------------------------------------------------
  icon('heart', 'Heart', 'symbols', Heart),
  icon('star', 'Star', 'symbols', Star),
  icon('sparkles', 'Sparkles', 'symbols', Sparkles),
  icon('zap', 'Zap bolt', 'symbols', Zap),
  icon('flame', 'Flame', 'symbols', Flame),
  icon('crown', 'Crown', 'symbols', Crown),
  icon('anchor', 'Anchor', 'symbols', Anchor),
  icon('skull', 'Skull', 'symbols', Skull),
  icon('ghost', 'Ghost', 'symbols', Ghost),
  icon('gem', 'Gem', 'symbols', Gem),
  icon('spade', 'Spade', 'symbols', Spade),
  icon('club', 'Club', 'symbols', Club),
  icon('infinity', 'Infinity', 'symbols', InfinityIcon),
  icon('smile', 'Smiley', 'symbols', Smile),
  icon('hand-metal', 'Rock hand', 'symbols', HandMetal),
  icon('party-popper', 'Party popper', 'symbols', PartyPopper),
  icon('crosshair', 'Crosshair', 'symbols', Crosshair),
]
