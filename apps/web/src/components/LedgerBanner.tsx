import { InlineNotification, Tag } from '@carbon/react';
import { Blockchain } from '@carbon/icons-react';
import type { LedgerMode } from '../types';

export function LedgerBanner({ mode, compact = false }: { mode: LedgerMode; compact?: boolean }) {
  if (compact) {
    return (
      <Tag type={mode === 'fabric' ? 'green' : 'warm-gray'} renderIcon={Blockchain}>
        {mode === 'fabric' ? 'Fabric 账本' : '演示账本'}
      </Tag>
    );
  }

  if (mode === 'fabric') return null;

  return (
    <InlineNotification
      className="ledger-banner"
      kind="warning"
      lowContrast
      hideCloseButton
      title="当前为演示账本"
      subtitle="页面中的交易回执用于流程预览，不能作为真实上链证明。"
    />
  );
}
