import React from 'react';

function Navbar({ activePage, onNavigate, cartCount, onOpenCart }) {
  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <div className="brand" onClick={() => onNavigate('home')}>
          <span className="brand-name">TechBIT</span>
          <span className="brand-tag">Контроль гальм та ходової</span>
        </div>

        <nav className="nav-links">
          <button
            type="button"
            className={`nav-btn ${activePage === 'home' ? 'active' : ''}`}
            onClick={() => onNavigate('home')}
          >
            Головна
          </button>
          <button
            type="button"
            className={`nav-btn ${activePage === 'catalog' ? 'active' : ''}`}
            onClick={() => onNavigate('catalog')}
          >
            Каталог
          </button>
          <button
            type="button"
            className={`nav-btn ${activePage === 'about' ? 'active' : ''}`}
            onClick={() => onNavigate('about')}
          >
            Про нас
          </button>
        </nav>

        <button type="button" className="cart-btn" onClick={onOpenCart}>
          <span>Кошик</span>
          <span className="cart-count">{cartCount}</span>
        </button>
      </div>
    </header>
  );
}

export default Navbar;
