const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const productsFilePath = path.join(__dirname, 'data', 'products.json');
const ordersFilePath = path.join(__dirname, 'data', 'orders.json');
const fleetFilePath = path.join(__dirname, 'data', 'fleet.json');

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Abstract Notification Dispatcher (MVP: TelegramNotifier; future: WhatsApp/Webhook)
// ============================================================================
function dispatchNotification(ticket, event, fleet) {
  const tractor = fleet.tractors.find((t) => t.id === event.tractor_id);
  const trailer = fleet.trailers.find((t) => t.id === event.trailer_id);
  const severityIcon =
    event.severity === 'RED' ? '🔴 КРИТИЧНА ТРИВОГА' : event.severity === 'SHADOW' ? '🟣 SHADOW LOG' : '⚠️ УВАГА (Жовтий рівень)';

  const telegramPreview = {
    channel: 'TelegramNotifier',
    suppressedForDriver: event.severity === 'SHADOW',
    text: `${severityIcon}\nАвто: ${tractor ? tractor.plate_number : event.tractor_id}${
      trailer ? ` + Причеп ${trailer.plate_number}` : ''
    }\nВузол: ${ticket.wheel_label}\nПричина: ${event.trigger_reason} (${event.temp_c}°C, ΔT +${event.peer_temp_delta_c}°C)\nПодія UTC: ${event.created_at_utc}`,
    inlineButtons: ['[👀 Прийнято в роботу]', '[✅ Закрити інцидент]']
  };

  return telegramPreview;
}

// ============================================================================
// Health & B2B Storefront Endpoints
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TechBIT IoT + SaaS API',
    utcTime: new Date().toISOString()
  });
});

app.get('/api/categories', (req, res) => {
  const products = loadJson(productsFilePath, []);
  res.json([
    {
      id: 'all',
      name: 'Усі позиції',
      description: 'Комплекти тягач/причеп, змінні вузли C3 та монтаж',
      count: products.length
    },
    {
      id: 'kit-coupling',
      name: 'Комплекти (Тягач / Причеп / Зчіпка)',
      description: 'Готові набори на 4, 6 або 10 коліс із чорною скринькою та LTE',
      count: products.filter((p) => p.category === 'kit-coupling').length
    },
    {
      id: 'modules',
      name: 'Модулі, джгути та сервісний монтаж',
      description: 'Вузли C3 Node, шлюзи ESP-NOW, контролери S3 та джгути Deutsch DT',
      count: products.filter((p) => p.category === 'modules').length
    }
  ]);
});

app.get('/api/products', (req, res) => {
  try {
    let products = loadJson(productsFilePath, []);
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
    } else if (sort === 'wheels-desc') {
      products.sort((a, b) => (b.wheelsCount || 0) - (a.wheelsCount || 0));
    }

    res.json({ total: products.length, items: products });
  } catch (err) {
    res.status(500).json({ error: 'Помилка завантаження каталогу' });
  }
});

app.get('/api/products/:id', (req, res) => {
  const products = loadJson(productsFilePath, []);
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Товар не знайдено' });
  res.json(product);
});

app.get('/api/about', (req, res) => {
  res.json({
    companyName: 'TechBIT',
    headline: 'B2B IoT + SaaS платформа предиктивного контролю ступиць та гальм вантажного транспорту',
    summary:
      'TechBIT замінює «досвідчене вухо» водія та дає власнику автопарку повний контроль над ходовою частиною тягачів і причепів: від миттєвої індикації колеса в кабіні до Telegram-алертів механіку й накопичення чорної скриньки.',
    teamMembers: [
      {
        name: 'Назарій Доскочинський',
        role: 'Hardware Architecture & 24V Electronics',
        email: 'nazar.doskochynskyi@gmail.com',
        responsibility:
          'Проєктування осьових вузлів C3 IP69K, захисту живлення Load Dump 40–60V, LTE/PSRAM контролера S3 та джгутів Deutsch DT / AMP Superseal.'
      },
      {
        name: 'Тарас Недовіз',
        role: 'Firmware DSP/ESP-NOW & Cloud Software',
        email: 'nedovizt26@gmail.com',
        responsibility:
          'Прошивка ESP32-C3 / S3, бездротовий місток причепа ESP-NOW LR AES-128, чорна скринька, хмарний Ingest API та пайплайн ML.'
      },
      {
        name: 'Матвій Івков',
        role: 'Mechanical Mounting, Field Testing & STO Rollout',
        email: 'matviyivk3@gmail.com',
        responsibility:
          'Кріплення на ступицях, термостійкі герметичні корпуси, випробування на пілотних автопарках і навчання партнерських СТО.'
      }
    ]
  });
});

// Замовлення обладнання з урахуванням SaaS підписки або Design Partners
app.post('/api/orders', (req, res) => {
  const { customerName, phone, deliveryMethod, fleetSize, purchasePlan, comment, items } = req.body;

  if (!customerName || !phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Вкажіть контактну особу / компанію, телефон та додайте комплекти у кошик.'
    });
  }

  const catalogProducts = loadJson(productsFilePath, []);
  const verifiedItems = [];

  for (const reqItem of items) {
    const product = catalogProducts.find((p) => p.id === Number(reqItem.id));
    if (!product) {
      return res.status(400).json({ error: `Товар з ID ${reqItem.id} не знайдено.` });
    }
    const qty = Math.max(1, Math.min(100, parseInt(reqItem.quantity, 10) || 1));
    verifiedItems.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: product.price,
      priceUsd: product.priceUsd,
      subscriptionMonthlyUah: product.subscriptionMonthlyUah || 0,
      quantity: qty
    });
  }

  const isDesignPartner = purchasePlan === 'design-partner';
  const totalAmount = verifiedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalUsd = verifiedItems.reduce((sum, item) => sum + (item.priceUsd || 0) * item.quantity, 0);
  const monthlySubscriptionUah = isDesignPartner
    ? 0
    : verifiedItems.reduce((sum, item) => sum + item.subscriptionMonthlyUah * item.quantity, 0);

  const orders = loadJson(ordersFilePath, []);
  const newOrder = {
    id: Date.now(),
    createdAtUtc: new Date().toISOString(),
    customerName: customerName.trim(),
    phone: phone.trim(),
    fleetSize: fleetSize || 'Не вказано',
    purchasePlan: isDesignPartner ? 'Design Partners (6 міс. підписки 0 грн)' : 'Стандарт B2B (Залізо + Cloud SaaS)',
    deliveryMethod: deliveryMethod || 'Нова Пошта + Монтаж на партнерському СТО',
    comment: comment ? comment.trim() : '',
    items: verifiedItems,
    totalAmount,
    totalUsd,
    monthlySubscriptionUah,
    status: 'Нове замовлення'
  };

  orders.push(newOrder);
  saveJson(ordersFilePath, orders);

  res.status(201).json({
    message: `Заявку №${newOrder.id} прийнято! Залізо: ${totalAmount} грн ($${totalUsd}), підписка: ${
      isDesignPartner ? '0 грн/міс (6 міс. Design Partner SLA)' : `${monthlySubscriptionUah} грн/міс`
    }.`,
    order: newOrder
  });
});

app.post('/api/consultations', (req, res) => {
  const { name, phone, vehicleInfo, fleetCount, programType } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Вкажіть ім’я та контактний телефон.' });
  }

  const orders = loadJson(ordersFilePath, []);
  const inquiry = {
    id: Date.now(),
    type: 'consultation',
    programType: programType || 'fleet-audit',
    createdAtUtc: new Date().toISOString(),
    customerName: name.trim(),
    phone: phone.trim(),
    fleetCount: fleetCount || 1,
    comment: vehicleInfo ? vehicleInfo.trim() : 'Запит на пілот / підбір TechBIT',
    status: 'Очікує дзвінка інженера'
  };

  orders.push(inquiry);
  saveJson(ordersFilePath, orders);

  res.status(201).json({
    message: 'Дякуємо! Інженер TechBIT зв’яжеться з вами для розрахунку комплектації та плану монтажу.'
  });
});

// ============================================================================
// MVP Cloud Backend API (Software Architecture Spec Section 4 & 5)
// ============================================================================
app.get('/api/fleet', (req, res) => {
  const fleet = loadJson(fleetFilePath, {});
  res.json(fleet);
});

// S3 -> Cloud Ingest Endpoint (JSON Contract Section 4.2)
app.post('/api/ingest', (req, res) => {
  const payload = req.body || {};
  const {
    protocol_version = 1,
    device_id,
    timestamp_utc,
    tractor_id,
    trailer_id,
    packet_type = 'ANOMALY_BURST',
    event_id,
    severity = 'YELLOW',
    trigger_node_id,
    trigger_reason = 'TEMP_DELTA_HIGH',
    summary = [],
    burst_samples_base64 = ''
  } = payload;

  if (!device_id || !tractor_id) {
    return res.status(400).json({ error: 'Поля device_id та tractor_id обов’язкові за протоколом v1.' });
  }

  const fleet = loadJson(fleetFilePath, {});
  const nowUtc = timestamp_utc || new Date().toISOString();

  // Update tractor online status & attach active trailer (Drop & Hook)
  const tractor = fleet.tractors.find((t) => t.id === tractor_id || t.s3_device_id === device_id);
  if (tractor) {
    tractor.last_seen_utc = nowUtc;
    tractor.online = true;
    if (trailer_id) tractor.attached_trailer_id = trailer_id;
  }

  // Update node telemetry summary
  for (const s of summary) {
    const node = fleet.sensor_nodes.find((n) => n.node_id === s.node_id);
    if (node) {
      if (typeof s.temp_c === 'number') node.temp_l_c = s.temp_c;
      if (typeof s.vib_rms === 'number') node.vib_rms_l = s.vib_rms;
      node.updated_at_utc = nowUtc;
    }
  }

  let createdTicket = null;
  let telegramPreview = null;

  if (packet_type === 'ANOMALY_BURST') {
    const evtId = event_id || `evt-${Date.now()}`;
    const trigNode = fleet.sensor_nodes.find((n) => n.node_id === trigger_node_id);
    const trigSummary = summary.find((s) => s.node_id === trigger_node_id) || summary[0] || {};
    const peerSummary = summary.find((s) => s.node_id !== trigger_node_id) || {};
    const tempVal = typeof trigSummary.temp_c === 'number' ? trigSummary.temp_c : 79.5;
    const peerTemp = typeof peerSummary.temp_c === 'number' ? peerSummary.temp_c : 35.0;

    const eventRecord = {
      event_id: evtId,
      created_at_utc: nowUtc,
      device_id,
      node_id: trigger_node_id || 'C3_998877',
      wheel_code: trigNode ? trigNode.code_l : 'P2-L',
      tractor_id,
      trailer_id: trailer_id || null,
      severity,
      trigger_reason,
      temp_c: tempVal,
      peer_temp_delta_c: Number((tempVal - peerTemp).toFixed(1)),
      vib_rms: trigSummary.vib_rms || 4.1,
      vib_peak: trigSummary.vib_peak || 12.8,
      raw_burst_s3_key: `bursts/${nowUtc.slice(0, 10)}/${evtId}.bin.gz`,
      burst_bytes: burst_samples_base64 ? burst_samples_base64.length : 1024,
      firmware_version: tractor ? tractor.firmware_version : '2.0.0-mvp',
      config_version: tractor ? tractor.config_version : 1,
      protocol_version
    };

    const trailer = fleet.trailers.find((t) => t.id === trailer_id);
    const wheelLabel = trigNode
      ? `${trigNode.asset_type === 'trailer' ? 'Причеп' : 'Тягач'}, Вісь ${trigNode.axle_num}, Ліве колесо (${trigNode.code_l})`
      : 'Причеп, Вісь 2, Ліве колесо (P2-L)';

    createdTicket = {
      ticket_id: `TKT-2026-${String(fleet.incident_tickets.length + 15).padStart(3, '0')}`,
      event_id: evtId,
      tractor_plate: tractor ? tractor.plate_number : tractor_id,
      trailer_plate: trailer ? trailer.plate_number : trailer_id || '—',
      wheel_label: wheelLabel,
      status: severity === 'SHADOW' ? 'CLOSED' : 'OPEN',
      resolution_code: severity === 'SHADOW' ? 'SHADOW_OBSERVATION' : null,
      mechanic_comment: severity === 'SHADOW' ? 'Автоматично записано в Shadow Mode для ML-бази.' : '',
      resolved_by: null,
      resolved_at_utc: null
    };

    fleet.anomaly_events.unshift(eventRecord);
    fleet.incident_tickets.unshift(createdTicket);
    telegramPreview = dispatchNotification(createdTicket, eventRecord, fleet);
  }

  saveJson(fleetFilePath, fleet);

  res.status(201).json({
    accepted: true,
    utcTime: nowUtc,
    ticket: createdTicket,
    notification: telegramPreview
  });
});

app.get('/api/incidents', (req, res) => {
  const fleet = loadJson(fleetFilePath, {});
  const { status, resolution } = req.query;

  const joined = (fleet.incident_tickets || []).map((tkt) => {
    const evt = (fleet.anomaly_events || []).find((e) => e.event_id === tkt.event_id) || {};
    return { ...tkt, event: evt };
  });

  let filtered = joined;
  if (status && status !== 'ALL') {
    filtered = filtered.filter((item) => item.status === status);
  }
  if (resolution && resolution !== 'ALL') {
    filtered = filtered.filter((item) => item.resolution_code === resolution);
  }

  res.json({ total: filtered.length, items: filtered });
});

// Close or acknowledge incident ticket (Mechanic 2-click Ground Truth)
app.patch('/api/incidents/:ticketId', (req, res) => {
  const { status, resolution_code, mechanic_comment, resolved_by } = req.body;
  const fleet = loadJson(fleetFilePath, {});
  const ticket = fleet.incident_tickets.find((t) => t.ticket_id === req.params.ticketId);

  if (!ticket) {
    return res.status(404).json({ error: 'Інцидент не знайдено.' });
  }

  if (status) ticket.status = status;
  if (resolution_code !== undefined) ticket.resolution_code = resolution_code;
  if (mechanic_comment !== undefined) ticket.mechanic_comment = mechanic_comment;
  if (status === 'CLOSED') {
    ticket.resolved_by = resolved_by || 'web_mechanic';
    ticket.resolved_at_utc = new Date().toISOString();
  }

  saveJson(fleetFilePath, fleet);
  res.json({ message: `Тікет ${ticket.ticket_id} оновлено.`, ticket });
});

// Export ML Ground Truth dataset (anomaly_events + incident_tickets)
app.get('/api/dataset/export', (req, res) => {
  const fleet = loadJson(fleetFilePath, {});
  const rows = (fleet.incident_tickets || []).map((tkt) => {
    const evt = (fleet.anomaly_events || []).find((e) => e.event_id === tkt.event_id) || {};
    return {
      event_id: evt.event_id,
      created_at_utc: evt.created_at_utc,
      tractor_id: evt.tractor_id,
      trailer_id: evt.trailer_id,
      node_id: evt.node_id,
      wheel_code: evt.wheel_code,
      severity: evt.severity,
      trigger_reason: evt.trigger_reason,
      temp_c: evt.temp_c,
      peer_temp_delta_c: evt.peer_temp_delta_c,
      vib_rms: evt.vib_rms,
      vib_peak: evt.vib_peak,
      ticket_status: tkt.status,
      ground_truth_label: tkt.resolution_code || 'UNLABELED',
      raw_burst_s3_key: evt.raw_burst_s3_key
    };
  });

  if (req.query.format === 'csv') {
    const header =
      'event_id,created_at_utc,tractor_id,trailer_id,node_id,wheel_code,severity,trigger_reason,temp_c,peer_temp_delta_c,vib_rms,vib_peak,ticket_status,ground_truth_label,raw_burst_s3_key';
    const csvLines = rows.map(
      (r) =>
        `${r.event_id},${r.created_at_utc},${r.tractor_id},${r.trailer_id || ''},${r.node_id},${r.wheel_code},${r.severity},${r.trigger_reason},${r.temp_c},${r.peer_temp_delta_c},${r.vib_rms},${r.vib_peak},${r.ticket_status},${r.ground_truth_label},${r.raw_burst_s3_key}`
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="techbit_ml_ground_truth.csv"');
    return res.send([header, ...csvLines].join('\n'));
  }

  res.json({ exportedAtUtc: new Date().toISOString(), count: rows.length, rows });
});

// Remote S3 Threshold Config Update
app.put('/api/devices/:deviceId/config', (req, res) => {
  const fleet = loadJson(fleetFilePath, {});
  const tractor = fleet.tractors.find((t) => t.s3_device_id === req.params.deviceId);
  if (!tractor) {
    return res.status(404).json({ error: 'Контролер S3 не знайдено.' });
  }

  tractor.thresholds_config = {
    ...tractor.thresholds_config,
    ...req.body
  };
  tractor.config_version = (tractor.config_version || 1) + 1;

  saveJson(fleetFilePath, fleet);
  res.json({
    message: `Конфігурацію v${tractor.config_version} збережено та підготовлено для синхронізації з ${tractor.s3_device_id} по LTE.`,
    tractor
  });
});

// Serve production React build
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[TechBIT Server] Node.js IoT + SaaS API запущено на http://localhost:${PORT}`);
});
