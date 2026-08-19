import { Tag } from '@carbon/react';
import { Blockchain } from '@carbon/icons-react';

/** Identifies the ledger backing the current view; the app runs on the real
 *  Hyperledger Fabric network, so the tag is a constant badge. */
export function LedgerBanner({ compact = false }: { compact?: boolean }) {
  if (!compact) return null;
  return (
    <Tag type="gray" className="ledger-mode-tag is-fabric" renderIcon={Blockchain}>
      Fabric 协作网络
    </Tag>
  );
}
