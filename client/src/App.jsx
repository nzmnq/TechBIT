import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import OrderModal from './components/OrderModal';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import AboutPage from './pages/AboutPage';

function App() {
  const [activePage, setActivePage] = useState('home');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [cartItems, setCartItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  function handleAddToCart(product) {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          sku: product.sku,
          name: product.name,
          price: product.price,
          quantity: 1
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
      prev.map((item) =>
        item.id === productId ? { ...item, quantity: Math.min(50, newQuantity) } : item
      )
    );
  }

  function handleRemoveFromCart(productId) {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  }

  function handleClearCart() {
    setCartItems([]);
  }

  const totalCartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-layout">
      <Navbar
        activePage={activePage}
        onNavigate={(page) => setActivePage(page)}
        cartCount={totalCartCount}
        onOpenCart={() => setIsCartOpen(true)}
      />

      <main className="main-content">
        <div className="container">
          {activePage === 'home' && (
            <HomePage
              onNavigate={(page) => setActivePage(page)}
              onSelectCategory={(cat) => setCatalogCategory(cat)}
            />
          )}

          {activePage === 'catalog' && (
            <CatalogPage
              initialCategory={catalogCategory}
              onAddToCart={handleAddToCart}
            />
          )}

          {activePage === 'about' && (
            <AboutPage onNavigate={(page) => setActivePage(page)} />
          )}
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
