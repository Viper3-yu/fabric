import { Button, InlineNotification, SkeletonPlaceholder, SkeletonText } from '@carbon/react';
import { DeliveryParcel, Renew } from '@carbon/icons-react';

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="page-skeleton" aria-label="正在加载" aria-busy="true">
      <SkeletonText heading width="36%" />
      <div className="page-skeleton__grid">
        {Array.from({ length: rows }, (_, index) => (
          <SkeletonPlaceholder key={index} className="page-skeleton__tile" />
        ))}
      </div>
      <SkeletonText paragraph lineCount={5} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block" role="alert">
      <InlineNotification
        kind="error"
        lowContrast
        hideCloseButton
        title="内容加载失败"
        subtitle={message}
      />
      {onRetry ? (
        <Button kind="tertiary" size="sm" renderIcon={Renew} onClick={onRetry}>
          重新加载
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <DeliveryParcel size={40} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
