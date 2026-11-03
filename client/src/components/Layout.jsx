import React from 'react';

const NAV_ITEMS = [
  { page: 'dashboard', icon: '◫', label: 'Dashboard' },
  { page: 'products', icon: '▦', label: 'Products' },
  { page: 'orders', icon: '☰', label: 'Orders' },
  { page: 'vendors', icon: '◉', label: 'Vendors' },
  { page: 'analytics', icon: '◔', label: 'Analytics' },
];

export default function Layout({ currentPage, onNavigate, onSearch, collapsed, onToggleSidebar, onToggleTheme, themeIcon, children }) {
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) onSearch(q);
    }
  };

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-icon">S</div>
          <span className="brand-text">ShopStream</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.page}
              className={`nav-item${currentPage === item.page ? ' active' : ''}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-toggle" onClick={onToggleSidebar}>◁</div>
          <span>Powered by Embr</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{currentPage.charAt(0).toUpperCase() + currentPage.slice(1)}</div>
          <div className="search-box">
            <span style={{ color: 'var(--text-muted)' }}>⌕</span>
            <input type="text" placeholder="Search products..." onKeyDown={handleSearchKeyDown} />
          </div>
          <button className="theme-btn" onClick={onToggleTheme} title="Toggle theme">{themeIcon}</button>
          <div className="avatar">AD</div>
        </header>
        <div className="content">
          {children}
        </div>
      </div>
    </div>
  );
}
