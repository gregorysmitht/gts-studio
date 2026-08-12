/* Every data-driven colour in one place.

   Air quality bands, temperature ramps, storm categories and the
   calendar swatches all used to carry their own hex literals, which
   meant a change of look had to be chased through five files. They live
   here now, tuned to the same muted, warm register as the rest of the
   hub: clay, ochre, sage, eucalyptus, slate. Nothing fluorescent.

   Escalation still reads. A hurricane category and an unhealthy AQI
   have to be unmistakable even on a display designed to be calm, so the
   ramps stay ordered and separable — just not neon. */

/* Semantic steps, low to high concern. */
export const CALM     = '#8FC4A4';   // sage
export const MILD     = '#DFC77E';   // wheat
export const NOTABLE  = '#DFA168';   // amber
export const HIGH     = '#D4816B';   // terracotta
export const SEVERE   = '#C4635C';   // clay red
export const EXTREME  = '#A886B8';   // muted plum
export const CRITICAL = '#9E5B4E';   // deep rust

/**
 * Calendar and family swatches. Chosen to stay distinguishable from
 * each other at the size of a 10px dot while sharing one temperature,
 * so a month grid reads as a palette rather than as confetti.
 */
export const PALETTE = [
  '#C97B6B',   // terracotta
  '#D9A05B',   // ochre
  '#C3B27E',   // olive sand
  '#8FA98A',   // sage
  '#7FA8A3',   // eucalyptus
  '#7B96B8',   // slate blue
  '#9B8AAE',   // plum
  '#C58EA0',   // dusty rose
  '#B5896B',   // clay
  '#A9B0A4',   // stone
  '#8FB0C4',   // sea
  '#BFA48E',   // linen
];

/** Cold to hot, for temperature bars and the hourly list. */
export const TEMP_STOPS = [
  [10,  '#8E8CC4'],
  [32,  '#7B9BC4'],
  [50,  '#7FAFB0'],
  [65,  '#93B58F'],
  [78,  '#D8BE7E'],
  [88,  '#DFA168'],
  [100, '#D4816B'],
];

/** Saffir–Simpson, 0 (tropical storm or weaker) through 5. */
export const STORM_CATEGORY = {
  0: '#8FB0C4', 1: '#D8BE7E', 2: '#DFA168',
  3: '#D4816B', 4: '#C4635C', 5: '#A886B8',
};

/** Radar reflectivity ramp, light through intense. */
export const RADAR_RAMP = ['#7FB4D4', '#8FC4A4', '#DFC77E', '#DFA168', '#D4816B', '#A886B8'];

/** Cold → hot temperature colour, used by every temperature bar and list. */
export const tempColor = (f) => rampColor(f, TEMP_STOPS);

/** Interpolate a value along a [threshold, colour] ramp. */
export function rampColor(value, stops = TEMP_STOPS) {
  if (value == null) return '#8A8A8A';
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      return mixHex(ca, cb, (value - a) / (b - a));
    }
  }
  return stops[stops.length - 1][1];
}

/** Straight sRGB blend — fine for short hops between adjacent stops. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
