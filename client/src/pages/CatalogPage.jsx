import React, { useEffect, useState } from 'react';
import ProductModal from '../components/ProductModal';

function CatalogPage({ initialCategory = 'all', onAddToCart }) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [activeProduct, setActiveProduct] = useState(null);

  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [vehicleType, setVehicleType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [maxPrice, setMaxPrice] = useState(35000);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState('default');

  useEffect(() => {
    setSelectedCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch('/api/categories');
        if (res.ok) {
          const data = await res.json();
          setCategories(data);
        }
      } catch (err) {
        // Fallback rendered below
      }
    }
    fetchCategories();
  }, []);

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
        if (!res.ok) throw new Error('Server error');
        const data = await res.json();
        setProducts(data.items || []);
      } catch (err) {
        setApiError('Не вдалося завантажити каталог із Node.js API.');
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
    setMaxPrice(35000);
    setInStockOnly(false);
    setSortBy('default');
  }

  return (
    <div>
      <div className="section-box" style={{ marginBottom: '20px', padding: '18px 24px' }}>
        <h1 className="page-title" style={{ marginBottom: '4px' }}>
          B2B Каталог обладнання та тарифів TechBIT
        </h1>
        <p className="page-subtitle" style={{ marginBottom: 0 }}>
          Уніфіковані комплекти для тягачів (4 колеса), напівпричепів (6 коліс), повних зчіпок (10 коліс) і змінні модулі на герметичних роз’ємах.
        </p>
      </div>

      <div className="catalog-layout">
        <aside className="filter-panel">
          <div className="filter-group">
            <span className="filter-title">Категорії</span>
            <div className="category-list">
              {(categories.length > 0
                ? categories
                : [
                    { id: 'all', name: 'Усі позиції', count: 8 },
                    { id: 'kit-coupling', name: 'Комплекти (Тягач / Причеп / Зчіпка)', count: 4 },
                    { id: 'modules', name: 'Модулі, джгути та сервісний монтаж', count: 4 }
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
              Пошук за назвою або SKU
            </label>
            <input
              id="filter-search"
              type="text"
              className="filter-input"
              placeholder="Напр.: причеп, S3, C3, пілот..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-vehicle">
              Призначення транспорту
            </label>
            <select
              id="filter-vehicle"
              className="filter-select"
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
            >
              <option value="all">Усі типи</option>
              <option value="coupling">Повна зчіпка (10 коліс)</option>
              <option value="tractor">Тягач (4 колеса / 2 осі)</option>
              <option value="trailer">Напівпричеп (6 коліс / 3 осі)</option>
              <option value="universal">Універсальні модулі та СТО</option>
            </select>
          </div>

          <div className="filter-group">
            <label className="filter-title" htmlFor="filter-price">
              Бюджет заліза до: <strong>{maxPrice.toLocaleString('uk-UA')} грн</strong>
            </label>
            <input
              id="filter-price"
              type="range"
              min="1500"
              max="35000"
              step="500"
              style={{ width: '100%' }}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#526273' }}>
              <span>1 500 грн</span>
              <span>35 000 грн</span>
            </div>
          </div>

          <div className="filter-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              <span>Тільки в наявності на складі</span>
            </label>
          </div>

          <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }} onClick={handleResetFilters}>
            Скинути фільтри
          </button>
        </aside>

        <div>
          <div className="catalog-toolbar">
            <div>
              Знайдено позицій: <strong>{products.length}</strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="sort-select" style={{ fontSize: '13px', color: '#526273' }}>
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
                <option value="wheels-desc">За кількістю коліс</option>
              </select>
            </div>
          </div>

          {apiError && (
            <div className="section-box" style={{ borderColor: '#b91c1c', color: '#b91c1c' }}>
              {apiError}
            </div>
          )}

          {loading ? (
            <div className="section-box">Завантаження каталогу...</div>
          ) : products.length === 0 ? (
            <div className="section-box">Нічого не знайдено. Спробуйте змінити фільтри.</div>
          ) : (
            <div className="products-grid">
              {products.map((product) => (
                <article key={product.id} className="product-card">
                  <div>
                    <div className="product-top-bar">
                      <span className="sku-tag">{product.sku}</span>
                      <span className={`stock-tag ${product.inStock ? 'in' : 'out'}`}>
                        {product.inStock ? 'В наявності' : 'Під замовлення'}
                      </span>
                    </div>

                    <h3 className="product-title">{product.name}</h3>

                    <div className="product-badges">
                      <span className="badge-item">{product.vehicleLabel}</span>
                      {product.wheelsCount > 0 && (
                        <span className="badge-item">Коліс: {product.wheelsCount}</span>
                      )}
                      {product.subscriptionMonthlyUah > 0 && (
                        <span className="badge-item badge-saas">
                          SaaS: {product.subscriptionMonthlyUah} грн/міс
                        </span>
                      )}
                      {product.isPilot && (
                        <span className="badge-item badge-pilot">0 грн SaaS / 6 міс.</span>
                      )}
                    </div>

                    <p className="product-desc">{product.shortDescription}</p>

                    {product.specs && (
                      <div className="product-specs">
                        <div>
                          <strong>Живлення:</strong> {product.specs.power}
                        </div>
                        <div>
                          <strong>Зв’язок:</strong> {product.specs.comms}
                        </div>
                        <div>
                          <strong>Захист:</strong> {product.specs.protection}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="product-footer">
                    <div>
                      <div className="product-price">
                        {product.price.toLocaleString('uk-UA')} грн{' '}
                        <span className="product-price-sub">(${product.priceUsd})</span>
                      </div>
                      {product.subscriptionMonthlyUah > 0 && (
                        <div className="product-price-sub">
                          + {product.subscriptionMonthlyUah} грн/міс (~${product.subscriptionUsd}) хмара
                        </div>
                      )}
                    </div>

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
                        Додати
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
