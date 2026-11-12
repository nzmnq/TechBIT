import React, { useEffect, useState } from 'react';

function CatalogPage({ initialCategory = 'all', onAddToCart }) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');

  // Стани фільтрів
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [vehicleType, setVehicleType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState(5000);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState('default');

  useEffect(() => {
    setSelectedCategory(initialCategory);
  }, [initialCategory]);

  // Завантаження списку категорій з Node.js API
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          setCategories(data);
        }
      } catch (err) {
        // Ігноруємо помилку, якщо сервер перезапускається
      }
    }
    fetchCategories();
  }, []);

  // Завантаження відфільтрованих товарів з Node.js API
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
          'Не вдалося отримати дані з Node.js API. Переконайтеся, що сервер запущено на порту 5000.'
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
    setMaxPrice(5000);
    setInStockOnly(false);
    setSortBy('default');
  }

  return (
    <div>
      <div className="section-box" style={{ marginBottom: '20px', padding: '18px 24px' }}>
        <h1 className="page-title" style={{ marginBottom: '4px' }}>
          Каталог систем та датчиків TechBit
        </h1>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          Оберіть комплект на 2 датчики (одна вісь) або повний комплект на всі 4 датчики для вашого автомобіля чи фури.
        </p>
      </div>

      <div className="catalog-layout">
        {/* Ліва панель фільтрів */}
        <aside className="filter-panel">
          <div className="filter-group">
            <span className="filter-title">Категорії комплектів</span>
            <div className="category-list">
              {(categories.length > 0
                ? categories
                : [
                    { id: 'all', name: 'Усі позиції', count: 8 },
                    { id: 'kit-4', name: 'Комплекти на 4 датчики (всі колеса)', count: 3 },
                    { id: 'kit-2', name: 'Комплекти на 2 датчики (1 вісь)', count: 3 },
                    { id: 'accessories', name: 'Модулі та комплектуючі', count: 2 }
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
              placeholder="Наприклад: фура, 2x, 4x, ACC..."
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
              <option value="truck">Фура / Вантажне авто (24V)</option>
              <option value="car">Легкове авто (12V)</option>
              <option value="van">Комерційний бус (12V/24V)</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-price">
              Максимальна ціна: <strong>{maxPrice} грн</strong>
            </label>
            <input
              id="filter-price"
              type="range"
              min="500"
              max="5000"
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
              <span>5 000 грн</span>
            </div>
          </div>

          <div className="filter-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              <span>Тільки товари в наявності</span>
            </label>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={handleResetFilters}
          >
            Скинути всі фільтри
          </button>
        </aside>

        {/* Права частина: сортування та список товарів */}
        <div>
          <div className="catalog-toolbar">
            <div>
              Знайдено позицій: <strong>{products.length}</strong>
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
                <option value="price-asc">Від дешевших до дорожчих</option>
                <option value="price-desc">Від дорожчих до дешевших</option>
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
            <div className="section-box">Завантаження каталогу з сервера...</div>
          ) : products.length === 0 ? (
            <div className="section-box">
              За обраними фільтрами товарів не знайдено. Спробуйте змінити категорію або скинути фільтри.
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
                        <div>
                          <strong>Обробка сигналу:</strong> {product.specs.sampling}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="product-footer">
                    <div className="product-price">{product.price} грн</div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onAddToCart(product)}
                    >
                      У замовлення
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CatalogPage;
