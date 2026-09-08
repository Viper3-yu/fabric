import { useEffect, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, PasswordInput, TextInput } from '@carbon/react';
import { ArrowRight, Blockchain, Information, Search } from '@carbon/icons-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/BrandMark';
import { api, getErrorMessage } from '../lib/api';
import type { LedgerMode } from '../types';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [networkMode, setNetworkMode] = useState<LedgerMode | null>(null);

  useEffect(() => {
    let active = true;
    api.network
      .info()
      .then(({ data }) => {
        if (active) setNetworkMode(data.mode);
      })
      .catch(() => {
        if (active) setNetworkMode(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (user) return <Navigate to="/app" replace />;

  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="login-title">
        <div className="login-brand">
          <BrandMark />
          <span className="login-brand__descriptor">可信物流协作网络</span>
        </div>
        <div className="login-intro__copy">
          <p className="eyebrow">从发货到签收 责任清晰可查</p>
          <h1 id="login-title">
            每次物流
            <span className="inline-route-image" aria-hidden="true" />
            <span className="login-title__tail">交接都有可信记录</span>
          </h1>
          <p className="login-lead">
            发货、承运、异常处理和签收都在同一张运单里协作，关键操作和文件核对编号都会自动保存。
          </p>
        </div>
        <div className="login-intro__footer">
          <Link className="public-entry" to="/track">
            <Search size={19} aria-hidden="true" />
            无需登录，查询公开物流
          </Link>
          <span>Hyperledger Fabric 应用实践</span>
        </div>
      </section>

      <section className="login-panel" aria-label="业务登录">
        <div className="login-panel__inner">
          <div className="login-panel__heading">
            <p className="eyebrow">业务工作台</p>
            <h2>欢迎回来</h2>
            <p>使用业务账户继续处理运单。</p>
          </div>

          <div className={`ledger-disclaimer ${networkMode === 'fabric' ? 'is-fabric' : ''}`}>
            {networkMode === 'fabric' ? (
              <Blockchain size={18} aria-hidden="true" />
            ) : (
              <Information size={18} aria-hidden="true" />
            )}
            <span>
              {networkMode === 'fabric'
                ? '当前已连接 Fabric 网络，关键业务记录会写入区块链。'
                : '正在确认记录服务状态。'}
            </span>
          </div>

          <Form onSubmit={handleSubmit} className="login-form">
            <TextInput
              id="username"
              labelText="用户名"
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.currentTarget.value)}
              required
            />
            <PasswordInput
              id="password"
              labelText="密码"
              value={password}
              autoComplete="current-password"
              showPasswordLabel="显示密码"
              hidePasswordLabel="隐藏密码"
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
            {error ? (
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title="登录失败"
                subtitle={error}
              />
            ) : null}
            <Button type="submit" renderIcon={ArrowRight} disabled={submitting}>
              {submitting ? '正在登录' : '进入工作台'}
            </Button>
          </Form>
        </div>
      </section>
    </main>
  );
}
