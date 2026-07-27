import { useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, TextInput, Tile } from '@carbon/react';
import {
  CheckmarkFilled,
  DataCheck,
  Blockchain,
  SearchLocate,
  WarningAltFilled,
} from '@carbon/icons-react';
import type { IntegrityResult } from '@jixin/shared';
import { useSearchParams } from 'react-router-dom';
import { LedgerBanner } from '../components/LedgerBanner';
import { PublicHeader } from '../components/PublicHeader';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import { formatDateTime } from '../lib/presentation';

export function VerifyPage() {
  const [params, setParams] = useSearchParams();
  const [trackingNumber, setTrackingNumber] = useState(params.get('trackingNumber') ?? '');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = trackingNumber.trim().toUpperCase();
    if (!normalized) return;
    setTrackingNumber(normalized);
    setParams({ trackingNumber: normalized });
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await api.public.verify(normalized, evidenceHash.trim() || undefined);
      setResult(response.data);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="public-page verify-page">
      <PublicHeader />
      <main id="main-content">
        <section className="verify-layout" aria-labelledby="verify-title">
          <div className="verify-intro">
            <p className="eyebrow">公开证据验真</p>
            <h1 id="verify-title">检查物流记录是否完整可信</h1>
            <p>输入运单号检查状态历史连续性，也可提交证据摘要进行链上比对。</p>
            <div className="verify-explainer">
              <div>
                <Blockchain size={24} aria-hidden="true" />
                <span>读取账本历史版本</span>
              </div>
              <div>
                <DataCheck size={24} aria-hidden="true" />
                <span>检查事件与状态连续性</span>
              </div>
              <div>
                <SearchLocate size={24} aria-hidden="true" />
                <span>比对资料或节点证据摘要</span>
              </div>
            </div>
          </div>

          <Tile className="verify-form-card">
            <h2>提交核验</h2>
            <Form onSubmit={handleSubmit}>
              <TextInput
                id="verify-tracking-number"
                labelText="物流运单号"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.currentTarget.value)}
                required
              />
              <TextInput
                id="verify-evidence-hash"
                labelText="证据 SHA-256 摘要（选填）"
                helperText="填写 64 位十六进制摘要，可比对发货资料或节点证据。"
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.currentTarget.value)}
                pattern="[A-Fa-f0-9]{64}"
              />
              {error ? (
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title="核验请求失败"
                  subtitle={error}
                />
              ) : null}
              <Button type="submit" renderIcon={DataCheck} disabled={loading}>
                {loading ? '正在核验' : '开始核验'}
              </Button>
            </Form>
          </Tile>
        </section>

        {result ? (
          <section className="verify-result" aria-live="polite">
            <LedgerBanner mode={result.ledgerMode} />
            <InlineNotification
              kind={
                result.verified ? 'success' : result.ledgerMode === 'demo' ? 'warning' : 'error'
              }
              lowContrast
              hideCloseButton
              title={
                result.verified
                  ? '核验通过'
                  : result.ledgerMode === 'demo'
                    ? '演示核验完成'
                    : '核验未通过'
              }
              subtitle={
                result.verified
                  ? '运单历史连续，提交的证据摘要与账本记录一致。'
                  : result.ledgerMode === 'demo'
                    ? '历史连续性已检查，但演示账本结果不能作为真实上链证明。'
                    : '发现历史不连续或证据摘要不匹配，请核对输入并联系业务方。'
              }
            />
            <div className="verify-result__header">
              <div>
                {result.verified ? (
                  <CheckmarkFilled size={40} aria-hidden="true" />
                ) : (
                  <WarningAltFilled size={40} aria-hidden="true" />
                )}
                <div>
                  <span className="mono">{result.trackingNumber}</span>
                  <h2>完整性核验报告</h2>
                </div>
              </div>
              <StatusTag status={result.status} />
            </div>
            <div className="verify-metrics">
              <Tile>
                <span>可信事件</span>
                <strong className="mono">{result.eventCount}</strong>
              </Tile>
              <Tile>
                <span>历史连续</span>
                <strong>{result.historyContinuous ? '是' : '否'}</strong>
              </Tile>
              <Tile>
                <span>账本模式</span>
                <strong>{result.ledgerMode === 'fabric' ? 'Fabric' : '演示账本'}</strong>
              </Tile>
              <Tile>
                <span>核验时间</span>
                <strong>{formatDateTime(result.checkedAt)}</strong>
              </Tile>
            </div>
            {result.warnings.length ? (
              <div className="verification-warnings">
                <h3>风险提示</h3>
                <ul>
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="verification-clean">
                <CheckmarkFilled size={20} aria-hidden="true" />
                <span>未发现额外风险提示</span>
              </div>
            )}
          </section>
        ) : null}
      </main>
      <footer className="public-footer">
        <span>迹信可信物流追踪</span>
        <span>公开核验结果不包含完整个人信息</span>
      </footer>
    </div>
  );
}
