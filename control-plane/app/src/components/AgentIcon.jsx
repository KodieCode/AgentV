// Pixel-art creature icons for the agent roster. Designed for dark
// backgrounds — single flat solid-colour fills, no gradients/shading/AA.
//
// HOW TO ADD AN AGENT ICON
// ------------------------
// Each agent (keyed by slug) gets a 7x7 grid. Each row is a 7-char string;
// 'X' = filled pixel, anything else = transparent. Add a matching COLOURS
// entry — pick a bright flat colour distinct from the others. Any slug
// without an entry falls back to FALLBACK_GRID + a hashed colour, so the
// roster always renders something sensible.
//
// Two generic starter creatures ship below as examples. Replace/extend per
// deployment — there is intentionally no fleet-specific art here.

const GRIDS = {
  // Generic "invader" silhouette.
  invader: [
    'X.X.X.X',
    '.XXXXX.',
    'XXXXXXX',
    'X.XXX.X',
    'XXXXXXX',
    '.X...X.',
    'X.....X',
  ],
  // Generic "bot" silhouette (antenna + boxy head).
  bot: [
    '..X.X..',
    '.XXXXX.',
    'XX.X.XX',
    'XXXXXXX',
    'X.XXX.X',
    'XXXXXXX',
    '.X...X.',
  ],
};

// Per-slug default colours. Bright + flat for dark backgrounds.
const COLOURS = {
  invader: '#5fc7ff',  // cyan
  bot: '#c4ff3d',      // lime
};

// Fallback grid for any unknown slug.
const FALLBACK_GRID = [
  '..XXX..',
  '.X...X.',
  'X.X.X.X',
  'XXXXXXX',
  'X.XXX.X',
  '.X...X.',
  'X.....X',
];

// Deterministic fallback colour from the slug, so unknown agents still get a
// stable, distinct hue instead of all rendering white.
const PALETTE = [
  '#5fc7ff', '#c4ff3d', '#ff8c1a', '#ff5fa2', '#a78bfa',
  '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#e879f9',
];
function hashColour(slug = '') {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function AgentIcon({ slug, size = 32, colour }) {
  const grid = GRIDS[slug] || FALLBACK_GRID;
  const fill = colour || COLOURS[slug] || hashColour(slug);
  const cols = grid[0].length;
  const rows = grid.length;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      style={{ display: 'block', imageRendering: 'pixelated' }}
      role="img"
      aria-label={`${slug} icon`}
    >
      {grid.map((row, y) =>
        [...row].map((cell, x) =>
          cell === 'X' ? (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />
          ) : null
        )
      )}
    </svg>
  );
}
