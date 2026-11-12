const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const productsFilePath = path.join(__dirname, 'data', 'products.json');
const ordersFilePath = path.join(__dirname, 'data', 'orders.json');

function loadProducts() {
  const raw = fs.readFileSync(productsFilePath, 'utf-8');
  return JSON.parse(raw);
}

function loadOrders() {
  if (!fs.existsSync(ordersFilePath)) {
    return [];
  }
  const raw = fs.readFileSync(ordersFilePath, 'utf-8');
  return JSON.parse(raw);
}

function saveOrders(orders) {
  fs.writeFileSync(ordersFilePath, JSON.stringify(orders, null, 2), 'utf-8');
}

// Перевірка роботи сервера
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TechBIT Store API',
    timestamp: new Date().toISOString()
  });
});

// Отримання списку категорій для фільтрів каталогу
app.get('/api/categories', (req, res) => {
  const products = loadProducts();

  const categories = [
    {
      id: 'all',
      name: 'Усі позиції',
      description: 'Повний асортимент систем контролю та комплектуючих TechBIT',
      count: products.length
    },
    {
      id: 'kit-4',
      name: 'Комплекти на 4 датчики (всі колеса)',
      description: 'Повний захист усіх 4 коліс із перехресним аналізом вібрації та температури',
      count: products.filter((p) => p.category === 'kit-4').length
    },
    {
      id: 'kit-2',
      name: 'Комплекти на 2 датчики (1 вісь)',
      description: 'Контроль однієї осі авто, мікроавтобуса, причепа чи лафета',
      count: products.filter((p) => p.category === 'kit-2').length
    },
    {
      id: 'accessories',
      name: 'Датчики та комплектуючі',
      description: 'Додаткові датчики, блоки управління та подовжені кабельні траси',
      count: products.filter((p) => p.category === 'accessories').length
    }
  ];

  res.json(categories);
});

// Отримання товарів із підтримкою фільтрації та сортування
app.get('/api/products', (req, res) => {
  try {
    let products = loadProducts();
    const { category, vehicleType, inStockOnly, maxPrice, search, sort } = req.query;

    if (category && category !== 'all') {
      products = products.filter((item) => item.category === category);
    }

    if (vehicleType && vehicleType !== 'all') {
      products = products.filter(
        (item) => item.vehicleType === vehicleType || item.vehicleType === 'universal'
      );
    }

    if (inStockOnly === 'true') {
      products = products.filter((item) => item.inStock === true);
    }

    if (maxPrice && !Number.isNaN(Number(maxPrice))) {
      products = products.filter((item) => item.price <= Number(maxPrice));
    }

    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      products = products.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.shortDescription.toLowerCase().includes(q)
      );
    }

    if (sort === 'price-asc') {
      products.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-desc') {
      products.sort((a, b) => b.price - a.price);
    } else if (sort === 'sensors-desc') {
      products.sort((a, b) => b.sensorsCount - a.sensorsCount);
    }

    res.json({
      total: products.length,
      items: products
    });
  } catch (err) {
    res.status(500).json({ error: 'Помилка завантаження каталогу товарів' });
  }
});

// Отримання одного товару за ID
app.get('/api/products/:id', (req, res) => {
  const products = loadProducts();
  const product = products.find((p) => p.id === Number(req.params.id));

  if (!product) {
    return res.status(404).json({ error: 'Товар не знайдено' });
  }

  res.json(product);
});

// Інформація про компанію TechBIT (суто для клієнтів та партнерів)
app.get('/api/about', (req, res) => {
  res.json({
    companyName: 'TechBIT',
    headline: 'Системи ранньої діагностики гальмівних колодок та ходової частини для вашого транспорту',
    summary:
      'TechBIT — українська команда розробників автомобільної електроніки та систем телеметрії. Ми створюємо надійні датчики моніторингу стану коліс, які допомагають водіям та власникам автопарків виявляти поломки на ранній стадії й уникати дорогого ремонту на трасі.',
    teamMembers: [
      {
        name: 'Назарій Доскочинський',
        role: 'Керівник напряму електроніки та виробництва',
        email: 'nazar.doskochynskyi@gmail.com',
        responsibility:
          'Відповідає за надійність електронних вузлів, захист обладнання від перепадів напруги та контроль якості кожної партії перед відправкою клієнтам.'
      },
      {
        name: 'Тарас Недовіз',
        role: 'Розробник програмного забезпечення та алгоритмів',
        email: 'nedovizt26@gmail.com',
        responsibility:
          'Розробив алгоритми аналізу вібрації та машинного навчання, які безпомилково відрізняють нерівності дороги від реального дефекту колодки чи підшипника.'
      },
      {
        name: 'Матвій Івков',
        role: 'Інженер з монтажу, механіки та випробувань',
        email: 'matviyivk3@gmail.com',
        responsibility:
          'Відповідає за герметичні корпуси IP67, універсальні кріплення під різні типи осей і консультації СТО та водіїв щодо встановлення.'
      }
    ]
  });
});

// Оформлення замовлення з каталогу
app.post('/api/orders', (req, res) => {
  const { customerName, phone, deliveryMethod, comment, items } = req.body;

  if (!customerName || !phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Будь ласка, вкажіть ім’я, контактний телефон та додайте хоча б один комплект.'
    });
  }

  const catalogProducts = loadProducts();
  const verifiedItems = [];

  for (const reqItem of items) {
    const product = catalogProducts.find((p) => p.id === Number(reqItem.id));
    if (!product) {
      return res.status(400).json({ error: `Товар з ID ${reqItem.id} не знайдено в каталозі.` });
    }
    const qty = Math.max(1, Math.min(50, parseInt(reqItem.quantity, 10) || 1));
    verifiedItems.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      quantity: qty
    });
  }

  const orders = loadOrders();
  const totalAmount = verifiedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const newOrder = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    customerName: customerName.trim(),
    phone: phone.trim(),
    deliveryMethod: deliveryMethod || 'Нова Пошта по Україні',
    comment: comment ? comment.trim() : '',
    items: verifiedItems,
    totalAmount,
    status: 'Нове замовлення'
  };

  orders.push(newOrder);
  saveOrders(orders);

  res.status(201).json({
    message: `Замовлення №${newOrder.id} успішно оформлено! Менеджер TechBIT зв’яжеться з вами найближчим часом.`,
    order: newOrder
  });
});

// Заявка на швидкий підбір / консультацію
app.post('/api/consultations', (req, res) => {
  const { name, phone, vehicleInfo } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Вкажіть ім’я та телефон для зворотного дзвінка.' });
  }

  const orders = loadOrders();
  const inquiry = {
    id: Date.now(),
    type: 'consultation',
    createdAt: new Date().toISOString(),
    customerName: name.trim(),
    phone: phone.trim(),
    comment: vehicleInfo ? vehicleInfo.trim() : 'Запит на підбір системи TechBIT',
    items: [],
    totalAmount: 0,
    status: 'Очікує консультації'
  };

  orders.push(inquiry);
  saveOrders(orders);

  res.status(201).json({
    message: 'Дякуємо! Спеціаліст TechBIT зателефонує вам та допоможе підібрати комплект під ваше авто.'
  });
});

// Роздача зібраного клієнта
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[TechBIT Server] Node.js API запущено на http://localhost:${PORT}`);
});
