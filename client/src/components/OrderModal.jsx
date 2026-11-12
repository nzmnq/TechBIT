import React, { useState } from 'react';

function OrderModal({ isOpen, onClose, cartItems, onRemoveItem, onClearCart }) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage('');
    setStatusMessage('');

    if (cartItems.length === 0) {
      setErrorMessage('Додайте хоча б один комплект із каталогу.');
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
          comment,
          items: cartItems
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || 'Помилка відправки замовлення');
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
          <h3>Оформлення замовлення TechBit</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Закрити
          </button>
        </div>

        {statusMessage && (
          <div
            style={{
              backgroundColor: '#e6f4ea',
              border: '1px solid #1f7a4c',
              color: '#1f7a4c',
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
              backgroundColor: '#fce8e6',
              border: '1px solid #b43c2f',
              color: '#b43c2f',
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
          <p style={{ color: '#52606d', marginBottom: '16px' }}>
            Список замовлення порожній. Перейдіть у каталог, щоб обрати комплект на 2 або 4 датчики.
          </p>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            {cartItems.map((item) => (
              <div key={item.id} className="cart-item-row">
                <div>
                  <strong>{item.name}</strong>
                  <div style={{ fontSize: '12px', color: '#52606d' }}>
                    Кількість: {item.quantity} шт. × {item.price} грн
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onRemoveItem(item.id)}
                >
                  Видалити
                </button>
              </div>
            ))}
            <div style={{ marginTop: '10px', textAlign: 'right', fontWeight: 700, fontSize: '16px' }}>
              Разом: {totalAmount} грн
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="order-name">Ваше ім’я або назва автопарку *</label>
            <input
              id="order-name"
              type="text"
              className="filter-input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Наприклад: Олександр / АТП Логістик"
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="order-phone">Телефон для зв’язку *</label>
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

          <div className="form-field">
            <label htmlFor="order-comment">Коментар (тип авто / кількість осей)</label>
            <input
              id="order-comment"
              type="text"
              className="filter-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Наприклад: Тягач DAF XF, потрібна консультація по ACC"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || cartItems.length === 0}
            >
              {submitting ? 'Відправка...' : 'Підтвердити замовлення'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrderModal;
