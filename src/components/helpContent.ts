const HELP_CONTENT = {
  title: 'How to Play',
  goal: {
    primary: 'Reach the star in 10 moves.',
    secondary: [
      '5 Lives. Losing a life adds a time penalty!',
      'Solve as fast as you can!',
    ],
  },
  controls: {
    title: 'Controls',
    labels: {
      swipe: 'Swipe',
      arrows: 'Arrow Keys',
      wasd: 'WASD',
    },
  },
  tiles: {
    title: 'Tiles',
    labels: {
      ice: 'Ice slides',
      ground: 'Ground stops',
      wall: 'Wall blocks',
      ledge: 'One-way in, any out',
    },
  },
  hints: {
    title: 'Hints',
    intro: 'After you lose a life:',
    caption: 'Correct moves from previous attempts turn green',
  },
  cta: 'Got it!',
} as const;

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(36);
}

const HELP_CONTENT_HASH = hashString(JSON.stringify(HELP_CONTENT));

export { HELP_CONTENT, HELP_CONTENT_HASH };
