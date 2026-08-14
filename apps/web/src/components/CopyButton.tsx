import { useEffect, useState } from 'react';
import { Button } from '@carbon/react';
import { Checkmark, Copy } from '@carbon/icons-react';

// navigator.clipboard only exists in secure contexts (HTTPS or localhost);
// fall back to the legacy selection API so copy still works over plain HTTP.
async function copyValue(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    setFailed(false);
    const success = await copyValue(value);
    setCopied(success);
    setFailed(!success);
  };

  return (
    <Button
      kind="ghost"
      size="sm"
      hasIconOnly
      renderIcon={copied ? Checkmark : Copy}
      iconDescription={failed ? '复制失败，请手动选择复制' : copied ? '已复制' : label}
      tooltipPosition="left"
      onClick={() => void handleCopy()}
    />
  );
}
