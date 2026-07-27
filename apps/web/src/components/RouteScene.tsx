const NODES = [
  { x: 11, y: 68, size: 8 },
  { x: 27, y: 45, size: 5 },
  { x: 43, y: 58, size: 6 },
  { x: 61, y: 31, size: 5 },
  { x: 76, y: 47, size: 7 },
  { x: 91, y: 22, size: 9 },
];

export function RouteScene({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`route-scene ${compact ? 'route-scene--compact' : ''}`}
      data-route-scene
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 82" preserveAspectRatio="none">
        <path
          className="route-scene__ghost"
          d="M-4 75 C18 62 20 35 41 55 C57 69 64 17 82 38 C91 47 96 27 104 14"
        />
        <path
          className="route-scene__line"
          pathLength="1"
          d="M-4 75 C18 62 20 35 41 55 C57 69 64 17 82 38 C91 47 96 27 104 14"
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
          <span className="route-scene__label route-scene__label--start">广州 08:30</span>
          <span className="route-scene__label route-scene__label--handoff">杭州 13:20</span>
          <span className="route-scene__label route-scene__label--eta">上海 ETA 18:30</span>
        </>
      ) : null}
    </div>
  );
}
