import { useEffect, useState } from 'react';
import {
  Add,
  Dashboard,
  DeliveryParcel,
  Logout,
  Menu,
  Search,
  UserAvatar,
} from '@carbon/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../lib/presentation';
import { BrandMark } from './BrandMark';
import { LedgerBanner } from './LedgerBanner';

interface NavItem {
  label: string;
  path: string;
  icon: typeof Dashboard;
  roles?: string[];
  external?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: '工作台', path: '/app', icon: Dashboard },
  { label: '运单管理', path: '/app/shipments', icon: DeliveryParcel },
  { label: '创建运单', path: '/app/shipments/new', icon: Add, roles: ['shipper'] },
  { label: '公开查询', path: '/track', icon: Search, external: true },
];

export function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/app') return pathname === itemPath;
  if (itemPath === '/app/shipments/new') return pathname === itemPath;
  if (itemPath === '/app/shipments') {
    return pathname.startsWith(itemPath) && pathname !== '/app/shipments/new';
  }
  return pathname === itemPath;
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, ledgerMode, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  if (!user || !ledgerMode) return null;

  const navItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role));
  const primaryNavItems = navItems.filter((item) => !item.external);
  const currentSection =
    location.pathname === '/app'
      ? '工作台'
      : location.pathname === '/app/shipments/new'
        ? '创建运单'
        : location.pathname === '/app/shipments'
          ? '运单管理'
          : location.pathname.startsWith('/app/shipments/')
            ? '运单详情'
            : '物流协作台';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="app-sidebar" aria-label="业务导航">
        <Link className="app-sidebar__brand" to="/app" aria-label="迹信工作台首页">
          <BrandMark />
          <span className="app-sidebar__product">物流协作台</span>
        </Link>

        <nav className="app-sidebar__links" aria-label="主导航">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(location.pathname, item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`app-sidebar__link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar__footer">
          <span>当前身份</span>
          <strong>{ROLE_LABELS[user.role]}</strong>
        </div>
      </aside>

      <header className="app-topbar">
        <div className="app-topbar__mobile">
          <button
            className="icon-button app-topbar__menu"
            type="button"
            aria-label={mobileNavOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            <Menu size={20} />
          </button>
          <Link className="app-topbar__brand" to="/app" aria-label="迹信工作台首页">
            <BrandMark />
          </Link>
        </div>

        <div className="app-topbar__context">
          <strong>{currentSection}</strong>
          <small>{ROLE_LABELS[user.role]}</small>
        </div>

        <div className="app-topbar__tools">
          <LedgerBanner mode={ledgerMode} compact />
          <Link className="app-topbar__public" to="/track">
            <Search size={17} aria-hidden="true" />
            <span>公开查询</span>
          </Link>
          <div
            className="app-topbar__user"
            title={`${user.displayName}，${ROLE_LABELS[user.role]}`}
          >
            <span className="app-topbar__avatar" aria-hidden="true">
              <UserAvatar size={18} />
            </span>
            <span>
              <strong>{user.displayName}</strong>
              <small>{ROLE_LABELS[user.role]}</small>
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="退出登录"
            onClick={handleLogout}
          >
            <Logout size={19} />
          </button>
        </div>
      </header>

      <div className={`mobile-nav ${mobileNavOpen ? 'is-open' : ''}`}>
        <nav aria-label="移动端导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavItemActive(location.pathname, item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={active ? 'is-active' : ''}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <main id="main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
