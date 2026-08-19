import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, TextInput, Tile } from '@carbon/react';
import {
  CheckmarkFilled,
  DataCheck,
  Blockchain,
  SearchLocate,
  WarningAltFilled,
} from '@carbon/icons-react';
import type { IntegrityResult } from '@jixin/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { PublicHeader } from '../components/PublicHeader';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import { formatDateTime } from '../lib/presentation';

export function VerifyPage() {
  const [params, setParams] = useSearchParams();
  const urlTracking = params.get('trackingNumber') ?? '';
  const [trackingNumber, setTrackingNumber] = useState(urlTracking);
  const [evidenceHash, setEvidenceHash] = useState('');
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchController = useRef<AbortController | null>(null);
  const lastChecked = useRef<string | null>(null);

  const runVerify = useCallback(async (normalized: string, evidence: string) => {
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await api.public.verify(
        normalized,
        evidence || undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult(response.data);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(caught));
    } finally {
      if (!controller.signal.aborted) {
        // 只在核对落定（含失败）后记名，被中止的请求不算完成——
        // StrictMode 开发态双挂载会先中止再重跑，提前记名会让第二次跳过。
        lastChecked.current = normalized;
        setLoading(false);
      }
    }
  }, []);

  // React to back/forward navigation and direct /verify?trackingNumber=… links.
  useEffect(() => {
    const normalized = urlTracking.trim().toUpperCase();
    if (!normalized || normalized === lastChecked.current) return;
    setTrackingNumber(normalized);
    void runVerify(normalized, '');
  }, [urlTracking, runVerify]);

  useEffect(() => () => searchController.current?.abort(), []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = trackingNumber.trim().toUpperCase();
    if (!normalized || loading) return;
    setTrackingNumber(normalized);
    setParams({ trackingNumber: normalized });
    await runVerify(normalized, evidenceHash.trim());
  };

  return (
    <div className="public-page verify-page">
      <PublicHeader />
      <main id="main-content">
        <section className="verify-layout" aria-labelledby="verify-title">
          <div className="verify-intro">
            <p className="eyebrow">公开记录核对</p>
            <h1 id="verify-title">
              <span>运输记录完整吗</span>
              <span>文件被换过吗</span>
            </h1>
            <p>
              输入运单号，系统会检查每次状态变化是否首尾相连；如果你有文件核对编号，也可以一起比对。
            </p>
            <div className="verify-explainer">
              <div>
                <span className="verify-explainer__index mono">01</span>
                <Blockchain size={24} aria-hidden="true" />
                <span>读取这张运单的每次修改</span>
              </div>
              <div>
                <span className="verify-explainer__index mono">02</span>
                <DataCheck size={24} aria-hidden="true" />
                <span>检查中间有没有缺少记录</span>
              </div>
              <div>
                <span className="verify-explainer__index mono">03</span>
                <SearchLocate size={24} aria-hidden="true" />
                <span>比对文件核对编号是否一致</span>
              </div>
            </div>
          </div>

          <Tile className="verify-form-card">
            <h2>输入要核对的内容</h2>
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
                labelText="文件核对编号（选填）"
                helperText="如果你有一串 64 位文件核对编号，可以填在这里检查是否一致。"
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.currentTarget.value)}
                pattern="[A-Fa-f0-9]{64}"
              />
              {error ? (
                <InlineNotification
                  kind="error"
                  lowContrast
                  hideCloseButton
                  title="暂时无法核对"
                  subtitle={error}
                />
              ) : null}
              <Button type="submit" renderIcon={DataCheck} disabled={loading}>
                {loading ? '正在检查记录' : '开始检查'}
              </Button>
            </Form>
          </Tile>
        </section>

        {result ? (
          <section className="verify-result" aria-live="polite">
            <InlineNotification
              kind={result.verified ? 'success' : 'error'}
              lowContrast
              hideCloseButton
              title={result.verified ? '记录完整，内容一致' : '发现不一致'}
              subtitle={
                result.verified
                  ? '这张运单的修改记录首尾相连，填写的文件核对编号也与系统保存的一致。'
                  : '中间可能缺少记录，或者文件核对编号不一致。请检查输入，也可以联系相关业务方。'
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
                  <span className="num">{result.trackingNumber}</span>
                  <h2>运输记录检查结果</h2>
                </div>
              </div>
              <StatusTag status={result.status} />
            </div>
            <div className="verify-metrics">
              <Tile>
                <span>操作记录</span>
                <strong className="num">{result.eventCount}</strong>
              </Tile>
              <Tile>
                <span>中间有无缺失</span>
                <strong>{result.historyContinuous ? '没有缺失' : '可能缺失'}</strong>
              </Tile>
              <Tile>
                <span>记录环境</span>
                <strong>Fabric 网络</strong>
              </Tile>
              <Tile>
                <span>检查时间</span>
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
        <span className="public-footer__brand">迹信可信物流追踪</span>
        <nav className="public-footer__nav" aria-label="页脚导航">
          <Link to="/track">物流查询</Link>
          <Link to="/verify">记录核对</Link>
          <Link to="/login">业务登录</Link>
        </nav>
        <span>公开检查结果不会显示完整个人信息</span>
      </footer>
    </div>
  );
}
