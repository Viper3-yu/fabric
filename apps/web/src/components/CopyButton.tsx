import { useEffect, useState } from 'react';
import { Button } from '@carbon/react';
import { Checkmark, Copy } from '@carbon/icons-react';

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  return (
    <Button
      kind="ghost"
      size="sm"
      hasIconOnly
      renderIcon={copied ? Checkmark : Copy}
      iconDescription={copied ? '已复制' : label}
      tooltipPosition="left"
      onClick={handleCopy}
    />
  );
}
