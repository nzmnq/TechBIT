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
    service: 'TechBit API',
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
      description: 'Повний перелік систем та комплектуючих TechBit',
      count: products.length
    },
    {
      id: 'kit-4',
      name: 'Комплекти на 4 датчики (всі колеса)',
      description: 'Повна система на 4 точки зчитування з перехресним порівнянням коліс',
      count: products.filter((p) => p.category === 'kit-4').length
    },
    {
      id: 'kit-2',
      name: 'Комплекти на 2 датчики (1 вісь)',
      description: 'Рішення для контролю однієї обраної осі (передньої або задньої)',
      count: products.filter((p) => p.category === 'kit-2').length
    },
    {
      id: 'accessories',
      name: 'Модулі та комплектуючі',
      description: 'Окремі датчики, центральні блоки обробки та живлення ACC',
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

    // Фільтр за категорією (kit-2, kit-4, accessories)
    if (category && category !== 'all') {
      products = products.filter((item) => item.category === category);
    }

    // Фільтр за типом транспорту (truck, car, van, universal)
    if (vehicleType && vehicleType !== 'all') {
      products = products.filter(
        (item) => item.vehicleType === vehicleType || item.vehicleType === 'universal'
      );
    }

    // Фільтр за наявністю
    if (inStockOnly === 'true') {
      products = products.filter((item) => item.inStock === true);
    }

    // Фільтр за максимальною ціною
    if (maxPrice && !Number.isNaN(Number(maxPrice))) {
      products = products.filter((item) => item.price <= Number(maxPrice));
    }

    // Пошук за назвою, артикулом або описом
    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      products = products.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.shortDescription.toLowerCase().includes(q)
      );
    }

    // Сортування
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

// Інформація про команду та курсовий проект TechBit
app.get('/api/about', (req, res) => {
  res.json({
    teamName: 'TechBIT',
    projectTitle: 'Автономна система вібраційного моніторингу підшипників маточини та підклинювання гальм',
    direction: 'Автомобільна телеметрія та IoT (Embedded Automotive IoT)',
    mvpBudget: '3 400 грн ($85)',
    bomTotal: '2 126.25 грн',
    summary:
      'Команда TechBIT розробляє систему для раннього виявлення заклинювання гальмівних колодок та руйнування підшипників маточини завдяки датчикам на кожному колесі, що безперервно аналізують вібрацію та температуру під час руху.',
    teamMembers: [
      {
        name: 'Назарій Доскочинський',
        role: 'Hardware Engineer / Lead',
        email: 'nazar.doskochynskyi@gmail.com',
        responsibility: 'Схемотехніка, аналоговий каскад (MCP6002-I/P, Vref=1.65В, K=3), розводка плати в KiCad, пайка та тестування захисту від перенапруг.'
      },
      {
        name: 'Тарас Недовіз',
        role: 'Firmware Engineer',
        email: 'nedovizt26@gmail.com',
        responsibility: 'Прошивка периферійних ESP32-C3 SuperMini та центральної ESP32-S3: АЦП 20 kSPS через DMA, алгоритм RMS, передача пакетів по CAN-шині (500 kbps).'
      },
      {
        name: 'Матвій Івков',
        role: 'Mechanical Engineer',
        email: 'matviyivk3@gmail.com',
        responsibility: 'Розробка кріплення датчиків детонації до ходової частини, проєктування герметичного корпусу IP67, калібрування та польові тести.'
      }
    ],
    howItWorks: [
      {
        step: '01',
        title: '4 датчики та аналоговий каскад',
        text: 'На кожне колесо встановлюється п’єзоелектричний датчик вібрації з каскадним підсилювачем на MCP6002-I/P (K=3, Vref=1.65В) і двоступеневим захистом BAT54 від ударів у ямах. Живлення подається від акумулятора у статусі ключа ACC через перетворювачі MP1584EN та Mini360.'
      },
      {
        step: '02',
        title: 'Оцифровка 20 kSPS та шина CAN',
        text: 'Колісні мікроконтролери ESP32-C3 SuperMini безперервно зчитують сигнал на частоті 20 kSPS через DMA, обчислюють середньоквадратичну амплітуду (RMS) і передають пакети по CAN-шині (SN65HVD230, 500 kbps) на центральний модуль ESP32-S3.'
      },
      {
        step: '03',
        title: 'Порівняння коліс та фільтрація поганої дороги',
        text: 'Система порівнює показники всіх коліс між собою. Одночасні сильні вібрації на всіх колесах під час руху по бруківці чи ямах розпізнаються як дорожнє покриття і не викликають хибної тривоги.'
      },
      {
        step: '04',
        title: 'ML-класифікація та сигнал на ТО',
        text: 'Машинне навчання та RMS-алгоритм відрізняють разовий удар від ями від тривалої аномалії (>3 секунд) та перегріву на одному колесі, вчасно попереджаючи водія про необхідність звернутися на ТО.'
      }
    ]
  });
});

// Оформлення замовлення з каталогу
app.post('/api/orders', (req, res) => {
  const { customerName, phone, comment, items } = req.body;

  if (!customerName || !phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Будь ласка, заповніть ім’я, телефон та оберіть хоча б один товар.'
    });
  }

  const orders = loadOrders();
  const totalAmount = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);

  const newOrder = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    customerName: customerName.trim(),
    phone: phone.trim(),
    comment: comment ? comment.trim() : '',
    items,
    totalAmount,
    status: 'Нове замовлення'
  };

  orders.push(newOrder);
  saveOrders(orders);

  res.status(201).json({
    message: 'Замовлення успішно прийнято! Команда TechBit зв’яжеться з вами.',
    order: newOrder
  });
});

// Роздача статики клієнта, якщо зібрано білд
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[TechBit Server] Node.js API запущено на http://localhost:${PORT}`);
});
