// Tiny line-style SVG icons for sidebar nav. 16x16, currentColor stroke,
// no fill, 1.4 stroke width.

const Icon = ({ children }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconRoster = () => (
  <Icon>
    <circle cx="5" cy="6" r="2" />
    <circle cx="11" cy="6" r="2" />
    <path d="M2 13c0-2 1.5-3 3-3s3 1 3 3" />
    <path d="M8 13c0-2 1.5-3 3-3s3 1 3 3" />
  </Icon>
);

export const IconIdeas = () => (
  <Icon>
    <path d="M8 2a4 4 0 0 0-2 7.5V11h4V9.5A4 4 0 0 0 8 2z" />
    <path d="M6 13h4" />
    <path d="M7 15h2" />
  </Icon>
);

export const IconBriefings = () => (
  <Icon>
    <path d="M3 2h7l3 3v9H3z" />
    <path d="M10 2v3h3" />
    <path d="M5.5 8h5" />
    <path d="M5.5 10.5h5" />
    <path d="M5.5 6h2.5" />
  </Icon>
);
