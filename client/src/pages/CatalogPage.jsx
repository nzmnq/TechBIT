import React, { useEffect, useState } from 'react';
import ProductModal from '../components/ProductModal';

function CatalogPage({ initialCategory = 'all', onAddToCart }) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [activeProduct, setActiveProduct] = useState(null);

  // Стани фільтрів
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [vehicleType, setVehicleType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState(6000);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState('default');

  useEffect(() => {
    setSelectedCategory(initialCategory);
  }, [initialCategory]);

  // Завантаження категорій з API
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          setCategories(data);
        }
      } catch (err) {
        // Fallback категорії залишаться доступними
      }
    }
    fetchCategories();
  }, []);

  // Завантаження відфільтрованих товарів з API
  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);
      setApiError('');

      try {
        const params = new URLSearchParams();
        if (selectedCategory !== 'all') params.append('category', selectedCategory);
        if (vehicleType !== 'all') params.append('vehicleType', vehicleType);
        if (searchQuery.trim() !== '') params.append('search', searchQuery.trim());
        if (maxPrice) params.append('maxPrice', String(maxPrice));
        if (inStockOnly) params.append('inStockOnly', 'true');
        if (sortBy !== 'default') params.append('sort', sortBy);

        const res = await fetch(`/api/products?${params.toString()}`);
        if (!res.ok) {
          throw new Error('Помилка відповіді сервера');
        }
        const data = await res.json();
        setProducts(data.items || []);
      } catch (err) {
        setApiError(
          'Не вдалося завантажити каталог із сервера. Переконайтеся, що Node.js сервер запущено.'
        );
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, [selectedCategory, vehicleType, searchQuery, maxPrice, inStockOnly, sortBy]);

  function handleResetFilters() {
    setSelectedCategory('all');
    setVehicleType('all');
    setSearchQuery('');
    setMaxPrice(6000);
    setInStockOnly(false);
    setSortBy('default');
  }

  return (
    <div>
      <div className="section-box" style={{ marginBottom: '20px', padding: '18px 24px' }}>
        <h1 className="page-title" style={{ marginBottom: '4px' }}>
          Каталог систем та датчиків TechBIT
        </h1>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          Оберіть готовий комплект на 4 колеса, на одну вісь (2 датчики) або додаткові комплектуючі для вашого транспорту.
        </p>
      </div>

      <div className="catalog-layout">
        {/* Панель фільтрів */}
        <aside className="filter-panel">
          <div className="filter-group">
            <span className="filter-title">Категорії</span>
            <div className="category-list">
              {(categories.length > 0
                ? categories
                : [
                    { id: 'all', name: 'Усі позиції', count: 9 },
                    { id: 'kit-4', name: 'Комплекти на 4 датчики (всі колеса)', count: 3 },
                    { id: 'kit-2', name: 'Комплекти на 2 датчики (1 вісь)', count: 3 },
                    { id: 'accessories', name: 'Датчики та комплектуючі', count: 3 }
                  ]
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`category-option ${selectedCategory === cat.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  <span>{cat.name}</span>
                  <span className="category-count">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-search">
              Пошук за назвою або артикулом
            </label>
            <input
              id="filter-search"
              type="text"
              className="filter-input"
              placeholder="Наприклад: фура, причіп, 2x, 4x..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-vehicle">
              Тип транспорту
            </label>
            <select
              id="filter-vehicle"
              className="filter-select"
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
            >
              <option value="all">Усі типи транспорту</option>
              <option value="truck">Фура / Причіп / Лафет</option>
              <option value="car">Легкове авто / 4WD (12V)</option>
              <option value="van">Комерційний бус / СТО</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-price">
              Ціна до: <strong>{maxPrice} грн</strong>
            </label>
            <input
              id="filter-price"
              type="range"
              min="500"
              max="6000"
              step="100"
              style={{ width: '100%' }}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#52606d',
                marginTop: '4px'
              }}
            >
              <span>500 грн</span>
              <span>6 000 грн</span>
            </div>
          </div>

          <div className="filter-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              <span>Тільки в наявності</span>
            </label>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={handleResetFilters}
          >
            Скинути фільтри
          </button>
        </aside>

        {/* Список товарів */}
        <div>
          <div className="catalog-toolbar">
            <div>
              Знайдено товарів: <strong>{products.length}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="sort-select" style={{ fontSize: '13.5px', color: '#52606d' }}>
                Сортування:
              </label>
              <select
                id="sort-select"
                className="filter-select"
                style={{ width: 'auto' }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="default">За замовчуванням</option>
                <option value="price-asc">Спочатку дешевші</option>
                <option value="price-desc">Спочатку дорожчі</option>
                <option value="sensors-desc">За кількістю датчиків</option>
              </select>
            </div>
          </div>

          {apiError && (
            <div className="section-box" style={{ borderColor: '#b43c2f', color: '#b43c2f' }}>
              {apiError}
            </div>
          )}

          {loading ? (
            <div className="section-box">Завантаження каталогу...</div>
          ) : products.length === 0 ? (
            <div className="section-box">
              За заданими фільтрами нічого не знайдено. Спробуйте змінити категорію або скинути фільтри.
            </div>
          ) : (
            <div className="products-grid">
              {products.map((product) => (
                <article key={product.id} className="product-card">
                  <div>
                    <div className="product-top-bar">
                      <span className="sku-tag">Артикул: {product.sku}</span>
                      <span className={`stock-tag ${product.inStock ? 'in' : 'out'}`}>
                        {product.inStock ? 'В наявності' : 'Під замовлення'}
                      </span>
                    </div>

                    <h3 className="product-title">{product.name}</h3>

                    <div className="product-badges">
                      <span className="badge-item">{product.categoryLabel}</span>
                      <span className="badge-item">{product.vehicleLabel}</span>
                      {product.sensorsCount > 0 && (
                        <span className="badge-item">Датчиків: {product.sensorsCount} шт.</span>
                      )}
                    </div>

                    <p className="product-desc">{product.shortDescription}</p>

                    {product.specs && (
                      <div className="product-specs">
                        <div>
                          <strong>Живлення:</strong> {product.specs.power}
                        </div>
                        <div>
                          <strong>Склад:</strong> {product.specs.sensors}
                        </div>
                        <div>
                          <strong>Захист:</strong> {product.specs.protection}
                        </div>
                        {product.warranty && (
                          <div>
                            <strong>Гарантія:</strong> {product.warranty}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="product-footer">
                    <div className="product-price">{product.price} грн</div>
                    <div className="product-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setActiveProduct(product)}
                      >
                        Детальніше
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onAddToCart(product)}
                      >
                        У кошик
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <ProductModal
        product={activeProduct}
        onClose={() => setActiveProduct(null)}
        onAddToCart={onAddToCart}
      />
    </div>
  );
}

export default CatalogPage;
