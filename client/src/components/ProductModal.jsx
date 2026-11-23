import React from 'react';

function ProductModal({ product, onClose, onAddToCart }) {
  if (!product) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="sku-tag">SKU: {product.sku}</span>
            <h3 style={{ marginTop: '6px' }}>{product.name}</h3>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>

        <div className="product-badges" style={{ marginBottom: '12px' }}>
          <span className="badge-item">{product.vehicleLabel}</span>
          {product.wheelsCount > 0 && (
            <span className="badge-item">Контроль коліс: {product.wheelsCount} шт.</span>
          )}
          {product.subscriptionMonthlyUah > 0 && (
            <span className="badge-item badge-saas">
              SaaS підписка: {product.subscriptionMonthlyUah} грн/міс (SIM включено)
            </span>
          )}
          {product.isPilot && (
            <span className="badge-item badge-pilot">Design Partner: 0 грн SaaS на 6 міс.</span>
          )}
          {product.warranty && <span className="badge-item">Гарантія: {product.warranty}</span>}
        </div>

        <p style={{ color: '#526273', marginBottom: '16px', fontSize: '14.5px' }}>
          {product.shortDescription}
        </p>

        {product.packageContents && product.packageContents.length > 0 && (
          <div className="modal-section">
            <h4>Комплектація та апаратні модулі:</h4>
            <ul className="about-list">
              {product.packageContents.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {product.features && product.features.length > 0 && (
          <div className="modal-section">
            <h4>Технічні та бізнес-переваги:</h4>
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
              <strong>Охоплення:</strong> {product.specs.sensors}
            </div>
            <div>
              <strong>Зв’язок:</strong> {product.specs.comms}
            </div>
            <div>
              <strong>Захист корпусу:</strong> {product.specs.protection}
            </div>
          </div>
        )}

        <div className="product-footer">
          <div>
            <div className="product-price">
              {product.price} грн <span className="product-price-sub">(${product.priceUsd})</span>
            </div>
            {product.subscriptionMonthlyUah > 0 && (
              <div className="product-price-sub">
                + {product.subscriptionMonthlyUah} грн/міс (~${product.subscriptionUsd}) хмарна підписка
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onAddToCart(product);
              onClose();
            }}
          >
            Додати до заявки
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductModal;
