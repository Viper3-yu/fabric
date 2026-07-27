import { useRef, useState, type FormEvent } from 'react';
import { Button, Form, InlineNotification, PasswordInput, TextInput } from '@carbon/react';
import { ArrowRight, Checkmark, Information, Search } from '@carbon/icons-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/BrandMark';
import { RouteScene } from '../components/RouteScene';
import { getErrorMessage } from '../lib/api';
import { useCinematicMotion } from '../lib/motion';

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
    description: '只读查询和交易证据核验',
  },
];

export function LoginPage() {
  const pageRef = useRef<HTMLElement>(null);
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('shipper');
  const [password, setPassword] = useState('shipper123');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useCinematicMotion(pageRef);

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
    <main className="login-page" ref={pageRef}>
      <section className="login-intro" aria-labelledby="login-title" data-motion="hero">
        <div className="login-brand" data-reveal>
          <BrandMark />
          <span className="login-brand__descriptor">可信物流协作网络</span>
        </div>
        <div className="login-intro__copy" data-reveal>
          <p className="eyebrow">从发货到签收，责任清晰可查</p>
          <h1 id="login-title">
            每次物流
            <span className="inline-route-image" aria-hidden="true" />
            <span className="login-title__tail">交接都有可信记录</span>
          </h1>
          <p className="login-lead">
            发货、承运、异常处理和签收在同一条责任链中完成，关键证据以摘要形式留存。
          </p>
        </div>
        <div className="login-route" data-reveal>
          <RouteScene compact />
          <div className="login-route__meta">
            <span>协作节点在线</span>
            <strong className="mono">ORG1 - ORG2</strong>
          </div>
        </div>
        <div className="login-intro__footer" data-reveal>
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

          <div className="ledger-disclaimer">
            <Information size={18} aria-hidden="true" />
            <span>演示账本仅用于流程预览，不作为真实 Fabric 上链证明。</span>
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
                    kind="ghost"
                    size="sm"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword(account.password);
                      setError('');
                    }}
                  >
                    使用此账户
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
