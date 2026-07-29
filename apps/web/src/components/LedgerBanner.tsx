import { InlineNotification, Tag } from '@carbon/react';
import { Blockchain } from '@carbon/icons-react';
import type { LedgerMode } from '../types';

export function LedgerBanner({ mode, compact = false }: { mode: LedgerMode; compact?: boolean }) {
  if (compact) {
    return (
      <Tag type="gray" className={`ledger-mode-tag is-${mode}`} renderIcon={Blockchain}>
        {mode === 'fabric' ? 'Fabric 协作网络' : '演示记录'}
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
      title="当前使用演示记录"
      subtitle="你可以体验完整流程，但这些记录没有写入真实的 Fabric 区块链网络。"
    />
  );
}
