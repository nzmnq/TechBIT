import React from 'react';

function ProductModal({ product, onClose, onAddToCart }) {
  if (!product) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="sku-tag">Артикул: {product.sku}</span>
            <h3 style={{ marginTop: '6px' }}>{product.name}</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>

        <div className="product-badges" style={{ marginBottom: '12px' }}>
          <span className="badge-item">{product.categoryLabel}</span>
          <span className="badge-item">{product.vehicleLabel}</span>
          {product.warranty && <span className="badge-item">Гарантія: {product.warranty}</span>}
          <span className={`badge-item ${product.inStock ? '' : 'stock-tag out'}`}>
            {product.inStock ? 'Є в наявності' : 'Під замовлення'}
          </span>
        </div>

        <p style={{ color: '#52606d', marginBottom: '16px', fontSize: '14.5px' }}>
          {product.shortDescription}
        </p>

        {product.packageContents && product.packageContents.length > 0 && (
          <div className="modal-section">
            <h4>Що входить у комплект:</h4>
            <ul className="about-list">
              {product.packageContents.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {product.features && product.features.length > 0 && (
          <div className="modal-section">
            <h4>Переваги для власника:</h4>
            <ul className="about-list">
              {product.features.map((feat, idx) => (
                <li key={idx}>{feat}</li>
              ))}
            </ul>
          </div>
        )}

        {product.specs && (
          <div className="product-specs" style={{ marginBottom: '16px' }}>
            <div>
              <strong>Живлення:</strong> {product.specs.power}
            </div>
            <div>
              <strong>Склад:</strong> {product.specs.sensors}
            </div>
            <div>
              <strong>Захист корпусу:</strong> {product.specs.protection}
            </div>
            <div>
              <strong>Монтаж:</strong> {product.specs.installation}
            </div>
          </div>
        )}

        <div className="product-footer">
          <div className="product-price">{product.price} грн</div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onAddToCart(product);
              onClose();
            }}
          >
            Додати до замовлення
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductModal;
