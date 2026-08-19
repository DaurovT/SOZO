import { graphTypeLabel, statusLabel, statusVariant } from '../dicts';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge--${statusVariant(status)}`}>{statusLabel(status)}</span>;
}

export function GraphTypeBadge({ graphType }: { graphType: string }) {
  const variant = graphType === 'emergency' ? 'error' : graphType === 'b2b' ? 'warning' : 'muted';
  return <span className={`badge badge--${variant}`}>{graphTypeLabel(graphType)}</span>;
}
