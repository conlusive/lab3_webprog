import fs from 'node:fs';
import http from 'node:http';
import { Command } from 'commander';

const program = new Command();

program
  .name('house-server')
  .description('HTTP-сервер, що віддає дані про будинки у форматі JSON')
  // -h потрібен для --host, тому довідка лишається тільки як --help
  .helpOption('--help', 'показати довідку')
  .requiredOption('-i, --input <path>', 'шлях до файлу даних')
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .option('-o, --output <path>', 'файл, у який записується остання відповідь');

program.parse();
const options = program.opts();

// Перевірка порту
if (!/^\d+$/.test(options.port) || Number(options.port) > 65535) {
  console.error('Некоректний порт: потрібне ціле число від 0 до 65535');
  process.exit(1);
}

// Перетворює значення (число або рядок) на число; якщо не вийшло — null
function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

// Відправляє JSON-відповідь
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Читає файл NDJSON; callback(err, records) — error-first
function readData(callback) {
  fs.readFile(options.input, 'utf8', (err, text) => {
    if (err) {
      callback(new Error('Не вдалося прочитати файл даних'));
      return;
    }
    const records = [];
    const lines = text.replace(/^﻿/, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') {
        continue; // порожні рядки пропускаємо
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch (parseError) {
        callback(new Error(`Файл даних пошкоджений (рядок ${i + 1})`));
        return;
      }
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        callback(new Error(`Файл даних пошкоджений (рядок ${i + 1})`));
        return;
      }
      records.push(record);
    }
    callback(null, records);
  });
}

// Обробка запиту
function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (urlError) {
    sendJson(res, 400, { error: 'Некоректна адреса запиту' });
    return;
  }

  if (url.pathname !== '/') {
    sendJson(res, 404, { error: 'Маршрут не знайдено' });
    return;
  }

  // furnished — прапорець, діє тільки значення "true"
  const onlyFurnished = url.searchParams.get('furnished') === 'true';

  // max_price — число, строга межа
  const maxPriceText = url.searchParams.get('max_price');
  let maxPrice = null;
  if (maxPriceText !== null) {
    maxPrice = toNumber(maxPriceText);
    if (maxPrice === null) {
      sendJson(res, 400, { error: 'Параметр max_price має бути числом' });
      return;
    }
  }

  readData((err, records) => {
    if (err) {
      sendJson(res, 500, { error: err.message });
      return;
    }

    const result = [];
    for (const record of records) {
      const price = toNumber(record.price);

      if (onlyFurnished && record.furnishingstatus !== 'furnished') {
        continue;
      }
      // price < max_price; якщо ціни немає — запис не проходить фільтр
      if (maxPrice !== null && (price === null || price >= maxPrice)) {
        continue;
      }

      result.push({
        price: price,
        area: toNumber(record.area),
        furnishingstatus: record.furnishingstatus ?? null,
      });
    }
    sendJson(res, 200, result);
  });
}

// Запуск: спочатку перевіряємо, що файл існує
fs.access(options.input, fs.constants.F_OK, (err) => {
  if (err) {
    console.error('Cannot find input file');
    process.exit(1);
  }

  const server = http.createServer(handleRequest);

  server.on('error', (serverError) => {
    console.error(`Помилка сервера: ${serverError.message}`);
    process.exit(1);
  });

  server.listen(Number(options.port), options.host, () => {
    console.log(`Сервер запущено: http://${options.host}:${options.port}/`);
  });
});
