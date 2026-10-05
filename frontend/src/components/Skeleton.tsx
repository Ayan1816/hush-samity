export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={`animate-pulse rounded bg-emerald-200/20 ${className}`} />;
}
