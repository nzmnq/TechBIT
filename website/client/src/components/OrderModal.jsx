import React, { useState } from 'react';

function OrderModal({
  isOpen,
  onClose,
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart
}) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [fleetSize, setFleetSize] = useState('1–5 фур');
  const [purchasePlan, setPurchasePlan] = useState('standard');
  const [deliveryMethod, setDeliveryMethod] = useState('Монтаж на партнерському СТО + Нова Пошта');
  const [comment, setComment] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalUsd = cartItems.reduce((sum, item) => sum + (item.priceUsd || 0) * item.quantity, 0);
  const rawMonthlyUah = cartItems.reduce(
    (sum, item) => sum + (item.subscriptionMonthlyUah || 0) * item.quantity,
    0
  );
  const effectiveMonthlyUah = purchasePlan === 'design-partner' ? 0 : rawMonthlyUah;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage('');
    setStatusMessage('');

    if (cartItems.length === 0) {
      setErrorMessage('Додайте хоча б один комплект або модуль із каталогу.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          phone,
          fleetSize,
          purchasePlan,
          deliveryMethod,
          comment,
          items: cartItems
        })
      });

      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.error || 'Помилка відправки замовлення.');
      } else {
        setStatusMessage(data.message);
        setCustomerName('');
        setPhone('');
        setComment('');
        onClearCart();
      }
    } catch (err) {
      setErrorMessage('Не вдалося з’єднатися з Node.js сервером.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Оформлення B2B-заявки</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>

        {statusMessage && (
          <div
            style={{
              backgroundColor: '#e6f4ea',
              border: '1px solid #1b7a48',
              color: '#1b7a48',
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '14px',
              fontSize: '14px'
            }}
          >
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #b91c1c',
              color: '#b91c1c',
              padding: '10px 12px',
              borderRadius: '6px',
              marginBottom: '14px',
              fontSize: '14px'
            }}
          >
            {errorMessage}
          </div>
        )}

        {cartItems.length === 0 ? (
          <p style={{ color: '#526273', marginBottom: '16px' }}>
            Заявка порожня. Перейдіть у каталог і оберіть комплект на тягач (4 колеса), причеп (6 коліс) чи повну зчіпку (10 коліс).
          </p>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            {cartItems.map((item) => (
              <div key={item.id} className="cart-item-row">
                <div style={{ flex: 1 }}>
                  <strong>{item.name}</strong>
                  <div style={{ fontSize: '12px', color: '#526273', marginTop: '2px' }}>
                    {item.price} грн (${item.priceUsd})
                    {item.subscriptionMonthlyUah > 0
                      ? ` • SaaS: ${item.subscriptionMonthlyUah} грн/міс`
                      : ''}
                  </div>
                </div>

                <div className="qty-control">
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  >
                    -
                  </button>
                  <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 600 }}>
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onRemoveItem(item.id)}
                >
                  ×
                </button>
              </div>
            ))}

            <div className="calc-summary-box" style={{ marginTop: '12px', padding: '12px 14px' }}>
              <div className="calc-row">
                <span>Залізо / послуги (разово):</span>
                <strong>
                  {totalAmount} грн (${totalUsd})
                </strong>
              </div>
              <div className="calc-row">
                <span>Хмарна підписка SaaS (SIM + Telegram):</span>
                <strong style={{ color: effectiveMonthlyUah === 0 ? '#1b7a48' : '#1a56a0' }}>
                  {effectiveMonthlyUah === 0
                    ? '0 грн/міс (6 міс. Design Partner SLA)'
                    : `${effectiveMonthlyUah} грн/міс`}
                </strong>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid-2" style={{ gap: '10px' }}>
            <div className="form-field">
              <label htmlFor="order-name">Компанія / Контакт *</label>
              <input
                id="order-name"
                type="text"
                className="filter-input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="ТОВ Агро-Транс / Олег"
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="order-phone">Телефон *</label>
              <input
                id="order-phone"
                type="tel"
                className="filter-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+380..."
                required
              />
            </div>
          </div>

          <div className="grid-2" style={{ gap: '10px' }}>
            <div className="form-field">
              <label htmlFor="order-plan">Формат співпраці</label>
              <select
                id="order-plan"
                className="filter-select"
                value={purchasePlan}
                onChange={(e) => setPurchasePlan(e.target.value)}
              >
                <option value="standard">Стандарт B2B (Залізо + Cloud SaaS)</option>
                <option value="design-partner">Design Partner (0 грн SaaS на 6 міс.)</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="order-fleet">Розмір автопарку</label>
              <select
                id="order-fleet"
                className="filter-select"
                value={fleetSize}
                onChange={(e) => setFleetSize(e.target.value)}
              >
                <option value="1–5 фур">1–5 зчіпок</option>
                <option value="6–20 фур">6–20 зчіпок</option>
                <option value="20–50+ фур">20–50+ зчіпок (Пілот / Опт)</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="order-delivery">Доставка та монтаж</label>
            <select
              id="order-delivery"
              className="filter-select"
              value={deliveryMethod}
              onChange={(e) => setDeliveryMethod(e.target.value)}
            >
              <option value="Монтаж на партнерському СТО + Нова Пошта">
                Нова Пошта + Монтаж на партнерському СТО (4–5 год)
              </option>
              <option value="Безготівковий рахунок (ТОВ з ПДВ/ФОП)">
                Безготівковий рахунок для автопарку + інструкція для власного електрика
              </option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="order-comment">Коментар (модель тягачів/причепів, місто)</label>
            <input
              id="order-comment"
              type="text"
              className="filter-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Напр.: DAF XF + Schmitz 3 осі, м. Вінниця"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || cartItems.length === 0}
            >
              {submitting ? 'Надсилання...' : 'Відправити B2B-заявку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrderModal;
