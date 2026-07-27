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
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="app-nav" data-motion="nav">
        <NavLink className="app-nav__brand" to="/app" aria-label="迹信工作台首页">
          <BrandMark />
          <span className="app-nav__product">可信物流控制台</span>
        </NavLink>

        <nav className="app-nav__links" aria-label="主导航">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/app'}
                className={({ isActive }) => `app-nav__link ${isActive ? 'is-active' : ''}`}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-nav__tools">
          <LedgerBanner mode={ledgerMode} compact />
          <NavLink className="app-nav__public" to="/track">
            <Search size={17} aria-hidden="true" />
            <span>公开查询</span>
          </NavLink>
          <div className="app-nav__user" title={`${user.displayName}，${ROLE_LABELS[user.role]}`}>
            <span className="app-nav__avatar" aria-hidden="true">
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
          <button
            className="icon-button app-nav__menu"
            type="button"
            aria-label={mobileNavOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      <div className={`mobile-nav ${mobileNavOpen ? 'is-open' : ''}`}>
        <nav aria-label="移动端导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/app'}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
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
