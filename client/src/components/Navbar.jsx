import React from 'react';
import { LOCALES } from '../i18n';

function Navbar({ activePage, onNavigate, cartCount, onOpenCart, locale, onToggleLocale }) {
  const t = LOCALES[locale] || LOCALES.uk;

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <div className="brand" onClick={() => onNavigate('home')}>
          <span className="brand-name">TechBIT</span>
          <span className="brand-tag">{t.nav.brandTag}</span>
        </div>

        <nav className="nav-links">
          <button
            type="button"
            className={`nav-btn ${activePage === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}
          >
            {t.nav.home}
          </button>
          <button
            type="button"
            className={`nav-btn ${activePage === 'catalog' ? 'active' : ''}`}
            onClick={() => onNavigate('catalog')}
          >
            {t.nav.catalog}
          </button>
          <button
            type="button"
            className={`nav-btn ${activePage === 'admin' ? 'active' : ''}`}
            onClick={() => onNavigate('admin')}
          >
            {t.nav.admin}
          </button>
          <button
            type="button"
            className={`nav-btn ${activePage === 'about' ? 'active' : ''}`}
            onClick={() => onNavigate('about')}
          >
            {t.nav.about}
          </button>
        </nav>

        <div className="nav-right">
          <button
            type="button"
            className="lang-switch"
            onClick={onToggleLocale}
            title="Перемкнути мову / Switch locale (i18n EU)"
          >
            {locale === 'uk' ? 'UA' : 'EN'}
          </button>
          <button type="button" className="cart-btn" onClick={onOpenCart}>
            <span>{t.nav.cart}</span>
            <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
