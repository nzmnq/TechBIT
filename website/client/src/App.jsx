import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import OrderModal from './components/OrderModal';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import AdminPage from './pages/AdminPage';
import AboutPage from './pages/AboutPage';

function App() {
  const [activePage, setActivePage] = useState('home');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [cartItems, setCartItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [locale, setLocale] = useState('uk');

  function handleAddToCart(product, qty = 1) {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + qty } : item
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          sku: product.sku,
          name: product.name,
          price: product.price,
          priceUsd: product.priceUsd || 0,
          subscriptionMonthlyUah: product.subscriptionMonthlyUah || 0,
          quantity: qty
        }
      ];
    });
    setIsCartOpen(true);
  }

  function handleUpdateQuantity(productId, newQuantity) {
    if (newQuantity <= 0) {
      handleRemoveFromCart(productId);
      return;
    }
    setCartItems((prev) =>
      prev.map((item) => (item.id === productId ? { ...item, quantity: newQuantity } : item))
    );
  }

  function handleRemoveFromCart(productId) {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  }

  function handleClearCart() {
    setCartItems([]);
  }

  const totalCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-layout">
      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        cartCount={totalCount}
        onOpenCart={() => setIsCartOpen(true)}
        locale={locale}
        onToggleLocale={() => setLocale((prev) => (prev === 'uk' ? 'en' : 'uk'))}
      />

      <main className="main-content">
        <div className="container">
          {activePage === 'home' && (
            <HomePage
              onNavigate={setActivePage}
              onSelectCategory={setCatalogCategory}
              onAddPackage={handleAddToCart}
            />
          )}

          {activePage === 'catalog' && (
            <CatalogPage initialCategory={catalogCategory} onAddToCart={handleAddToCart} />
          )}

          {activePage === 'admin' && <AdminPage locale={locale} />}

          {activePage === 'about' && <AboutPage onNavigate={setActivePage} />}
        </div>
      </main>

      <Footer />

      <OrderModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveFromCart}
        onClearCart={handleClearCart}
      />
    </div>
  );
}

export default App;
