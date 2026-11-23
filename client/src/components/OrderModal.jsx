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
  const [deliveryMethod, setDeliveryMethod] = useState('Нова Пошта по Україні');
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
          deliveryMethod,
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
      setErrorMessage('Не вдалося з’єднатися з сервером. Спробуйте ще раз.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Оформлення замовлення</h3>
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
            Кошик порожній. Перейдіть у каталог, щоб обрати комплект на 2 або 4 датчики.
          </p>
        ) : (
          <div style={{ marginBottom: '16px' }}>
            {cartItems.map((item) => (
              <div key={item.id} className="cart-item-row">
                <div style={{ flex: 1 }}>
                  <strong>{item.name}</strong>
                  <div style={{ fontSize: '12.5px', color: '#52606d', marginTop: '2px' }}>
                    {item.price} грн / шт.
                  </div>
                </div>

                <div className="qty-control">
                  <button
                    type="button"
                    className="qty-btn"
                    onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                    title="Зменшити кількість"
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
                    title="Збільшити кількість"
                  >
                    +
                  </button>
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
            <div style={{ marginTop: '12px', textAlign: 'right', fontWeight: 700, fontSize: '17px' }}>
              Разом до сплати: {totalAmount} грн
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="order-name">Ім’я або назва компанії / автопарку *</label>
            <input
              id="order-name"
              type="text"
              className="filter-input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Наприклад: Олександр або ТОВ Логістика"
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
            <label htmlFor="order-delivery">Спосіб отримання</label>
            <select
              id="order-delivery"
              className="filter-select"
              value={deliveryMethod}
              onChange={(e) => setDeliveryMethod(e.target.value)}
            >
              <option value="Нова Пошта по Україні">Нова Пошта по Україні (відділення / кур’єр)</option>
              <option value="Самовивіз / Монтаж на СТО">Самовивіз або консультація з монтажу на СТО</option>
              <option value="Корпоративне замовлення (безготівка)">Для автопарку (рахунок / безготівковий розрахунок)</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="order-comment">Модель авто / місто доставки</label>
            <input
              id="order-comment"
              type="text"
              className="filter-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Наприклад: м. Львів, DAF XF або Mercedes Sprinter"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || cartItems.length === 0}
            >
              {submitting ? 'Оформлення...' : 'Підтвердити замовлення'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrderModal;
