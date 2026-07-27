export function BrandMark({ label = '迹信' }: { label?: string }) {
  return (
    <span className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-lockup__name">{label}</span>
    </span>
  );
}
