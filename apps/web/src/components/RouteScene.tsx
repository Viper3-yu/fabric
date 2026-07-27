const NODES = [
  { x: 10, y: 71.73, size: 8 },
  { x: 27, y: 60.68, size: 5 },
  { x: 43, y: 57.04, size: 6 },
  { x: 59, y: 50.38, size: 5 },
  { x: 75, y: 38.1, size: 7 },
  { x: 91, y: 28.85, size: 9 },
];

export function RouteScene({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`route-scene ${compact ? 'route-scene--compact' : ''}`}
      data-route-scene
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          className="route-scene__ghost"
          d="M-4 79 C18 70 24 57 42 57 C58 58 64 41 78 37 C90 33 97 22 104 14"
        />
        <path
          className="route-scene__line"
          pathLength="1"
          d="M-4 79 C18 70 24 57 42 57 C58 58 64 41 78 37 C90 33 97 22 104 14"
          data-route-line
        />
      </svg>
      {NODES.map((node, index) => (
        <span
          key={`${node.x}-${node.y}`}
          className={`route-scene__node ${index === NODES.length - 1 ? 'is-live' : ''}`}
          style={{ left: `${node.x}%`, top: `${node.y}%`, width: node.size, height: node.size }}
          data-route-node
        />
      ))}
      {!compact ? (
        <>
          <span className="route-scene__label route-scene__label--start">入场 08:30</span>
          <span className="route-scene__label route-scene__label--handoff">交接 13:20</span>
          <span className="route-scene__label route-scene__label--eta">到仓 ETA 18:30</span>
        </>
      ) : null}
    </div>
  );
}
