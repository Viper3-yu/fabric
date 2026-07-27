import { CertificateCheck, Login } from '@carbon/icons-react';
import { NavLink } from 'react-router-dom';
import { BrandMark } from './BrandMark';

export function PublicHeader() {
  return (
    <header className="public-nav" data-motion="nav">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <NavLink className="public-nav__brand" to="/track" aria-label="迹信公开物流查询首页">
        <BrandMark />
        <span>可信物流追踪</span>
      </NavLink>
      <nav className="public-nav__links" aria-label="公开服务导航">
        <NavLink to="/track">物流查询</NavLink>
        <NavLink to="/verify">记录核对</NavLink>
      </nav>
      <div className="public-nav__actions">
        <NavLink className="public-nav__verify" to="/verify" aria-label="核对运输记录">
          <CertificateCheck size={18} aria-hidden="true" />
          <span>核对记录</span>
        </NavLink>
        <NavLink className="public-nav__login" to="/login">
          <span>业务登录</span>
          <Login size={18} aria-hidden="true" />
        </NavLink>
      </div>
    </header>
  );
}
