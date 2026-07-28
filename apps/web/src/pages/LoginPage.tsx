import { useEffect, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, PasswordInput, TextInput } from '@carbon/react';
import { ArrowRight, Blockchain, Checkmark, Information, Search } from '@carbon/icons-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/BrandMark';
import { api, getErrorMessage } from '../lib/api';
import type { LedgerMode } from '../types';

const DEMO_ACCOUNTS = [
  {
    role: '发货方',
    username: 'shipper',
    password: 'shipper123',
    description: '创建和取消待接单运单',
  },
  {
    role: '承运方',
    username: 'carrier',
    password: 'carrier123',
    description: '接单、运输、异常和送达',
  },
  {
    role: '收货方',
    username: 'receiver',
    password: 'receiver123',
    description: '使用一次性签收码确认收货',
  },
  {
    role: '审计访客',
    username: 'auditor',
    password: 'auditor123',
    description: '只读查看运输和修改记录',
  },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('shipper');
  const [password, setPassword] = useState('shipper123');
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
            <p>使用业务账户继续处理运单，或选择一个演示角色快速进入。</p>
          </div>

          <div className={`ledger-disclaimer ${networkMode === 'fabric' ? 'is-fabric' : ''}`}>
            {networkMode === 'fabric' ? (
              <Blockchain size={18} aria-hidden="true" />
            ) : (
              <Information size={18} aria-hidden="true" />
            )}
            <span>
              {networkMode === 'fabric'
                ? '当前已连接真实 Fabric 网络，关键业务记录会写入区块链。该网络仍用于测试，不等同于生产环境。'
                : networkMode === 'demo'
                  ? '当前是演示环境，可以体验完整流程，但记录没有写入真实 Fabric 区块链网络。'
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

          <div className="demo-accounts" aria-labelledby="demo-account-title">
            <div className="demo-accounts__heading">
              <h3 id="demo-account-title">演示账户</h3>
              <span>点击即可自动填充</span>
            </div>
            <div className="demo-accounts__grid">
              {DEMO_ACCOUNTS.map((account) => (
                <article
                  key={account.username}
                  className={`demo-account ${username === account.username ? 'is-selected' : ''}`}
                >
                  <div className="demo-account__top">
                    <span className="demo-account__index">{account.role.slice(0, 1)}</span>
                    {username === account.username ? (
                      <Checkmark size={18} aria-hidden="true" />
                    ) : null}
                  </div>
                  <div className="demo-account__copy">
                    <strong>{account.role}</strong>
                    <span>{account.description}</span>
                  </div>
                  <p className="mono">
                    <span>{account.username}</span>
                    <span aria-hidden="true"> / </span>
                    <span>{account.password}</span>
                  </p>
                  <Button
                    kind={username === account.username ? 'primary' : 'secondary'}
                    size="sm"
                    renderIcon={username === account.username ? Checkmark : ArrowRight}
                    aria-pressed={username === account.username}
                    aria-label={
                      username === account.username
                        ? `已选择${account.role}账户`
                        : `使用${account.role}账户`
                    }
                    onClick={() => {
                      setUsername(account.username);
                      setPassword(account.password);
                      setError('');
                    }}
                  >
                    {username === account.username ? '已选择此账户' : '使用此账户'}
                  </Button>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
