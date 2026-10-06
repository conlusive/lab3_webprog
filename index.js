import { readFileSync } from 'node:fs';
import { Command, Option, InvalidArgumentError } from 'commander';

const DEFAULT_FILE = 'data.json';

class CliError extends Error {}

// ---------- читання даних ----------
function loadData(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError(`Файл не знайдено: ${filePath}`);
    if (err.code === 'EISDIR') throw new CliError(`Це тека, а не файл: ${filePath}`);
    if (err.code === 'EACCES') throw new CliError(`Немає доступу до файлу: ${filePath}`);
    throw new CliError(`Не вдалося прочитати ${filePath}: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new CliError(`Файл ${filePath} містить некоректний JSON: ${err.message}`);
  }

  if (data === null || typeof data !== 'object' || !Array.isArray(data.items)) {
    throw new CliError(`Файл ${filePath} має неочікувану структуру: потрібен корінь із масивом "items".`);
  }
  // Корінь не має поля type, тому робимо з нього «віртуальну» теку.
  return { ...data, type: 'directory' };
}

// ---------- робота з деревом (залежить від структури JSON) ----------
const isFolder = (node) => node.type === 'directory';
const childrenOf = (node) => (isFolder(node) && Array.isArray(node.items) ? node.items : []);
const sizeOf = (node) => (Number.isFinite(node.sizeBytes) ? node.sizeBytes : 0);

function findNode(root, pathText) {
  let current = root;
  for (const part of pathText.split('/').filter(Boolean)) {
    if (!isFolder(current)) {
      throw new CliError(`«${current.name}» не є текою, у ній немає «${part}».`);
    }
    const next = childrenOf(current).find((child) => child.name === part);
    if (!next) throw new CliError(`Елемент не знайдено: ${pathText}`);
    current = next;
  }
  return current;
}

function* walk(node, prefix = '') {
  for (const child of childrenOf(node)) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    yield { node: child, path };
    yield* walk(child, path);
  }
}

function totalSize(node) {
  if (!isFolder(node)) return sizeOf(node);
  return childrenOf(node).reduce((sum, child) => sum + totalSize(child), 0);
}

function getByPath(object, fieldPath) {
  let current = object;
  for (const key of fieldPath.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
      return { found: false };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

// ---------- форматування ----------
function formatSize(bytes) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${bytes} Б` : `${value.toFixed(1)} ${units[i]}`;
}

function formatLine(node, path) {
  const folder = isFolder(node);
  const kind = folder ? 'тека ' : 'файл ';
  const size = folder ? '' : `  ${formatSize(sizeOf(node))}`;
  const hidden = node.isHidden === true ? '  [прихований]' : '';
  return `${kind}  ${path}${folder ? '/' : ''}${size}${hidden}`;
}

function printValue(value) {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

// ---------- перевірка значень опцій ----------
function parsePositiveInt(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError('потрібне додатне ціле число.');
  }
  return Number(value);
}

// ---------- українські повідомлення commander ----------
function translateError(message) {
  const line = message.trim().split('\n')[0];
  const rules = [
    [/^error: missing required argument '(.+)'$/, (m) => `не вказано обов'язковий аргумент '${m[1]}'`],
    [/^error: unknown option '(.+)'$/, (m) => `невідома опція '${m[1]}'`],
    [/^error: unknown command '(.+)'$/, (m) => `невідома команда '${m[1]}'`],
    [/^error: option '(.+)' argument missing$/, (m) => `для опції '${m[1]}' не вказано значення`],
    [/^error: too many arguments for '(.+)'\. Expected (\d+) arguments? but got (\d+)\.$/,
      (m) => `забагато аргументів для '${m[1]}': очікується ${m[2]}, отримано ${m[3]}`],
    [/^error: option '(.+)' argument '(.*)' is invalid\.\s*(.*)$/,
      (m) => `некоректне значення '${m[2]}' для опції '${m[1]}': ${m[3].replace('Allowed choices are', 'допустимі значення —')}`],
    [/^error: option '(.+)' argument '(.*)' is not allowed\. Allowed choices are (.+)\.$/,
      (m) => `значення '${m[2]}' для опції '${m[1]}' не дозволене, допустимі: ${m[3]}`],
  ];
  for (const [regex, build] of rules) {
    const match = line.match(regex);
    if (match) return `Помилка: ${build(match)}`;
  }
  return `Помилка виклику: ${line.replace(/^error: /, '')}`;
}

const HELP_TITLES = {
  'Usage:': 'Використання:',
  'Options:': 'Опції:',
  'Commands:': 'Команди:',
  'Arguments:': 'Аргументи:',
};

// ---------- опис програми ----------
const program = new Command();

program
  .name('catalog')
  .description('Перегляд каталогу файлів, описаного у JSON-файлі')
  .version('1.0.0', '-v, --version', 'показати версію програми')
  .helpOption('-h, --help', 'показати довідку')
  .helpCommand('help [command]', 'показати довідку щодо команди')
  .option('-f, --file <path>', 'шлях до JSON-файлу з даними', DEFAULT_FILE)
  .showHelpAfterError('(скористайтеся --help, щоб побачити довідку)')
  .configureOutput({
    outputError: (message, write) => write(`${translateError(message)}\n`),
  })
  .configureHelp({
    styleTitle: (title) => HELP_TITLES[title] ?? title,
  });

const data = () => loadData(program.opts().file);

// ---------- загальні можливості ----------
program
  .command('list')
  .description('показати стислий список усіх елементів каталогу')
  .option('-n, --limit <count>', 'показати не більше вказаної кількості елементів', parsePositiveInt)
  .action((options) => {
    let items = [...walk(data())];
    if (options.limit !== undefined) items = items.slice(0, options.limit);
    for (const { node, path } of items) console.log(formatLine(node, path));
  });

program
  .command('show')
  .description('показати один елемент цілком')
  .argument('<path>', 'шлях до елемента від кореня, наприклад src/main.py')
  .action((pathText) => {
    printValue(findNode(data(), pathText));
  });

program
  .command('get')
  .description('показати значення окремого поля елемента (у тому числі вкладеного)')
  .argument('<path>', 'шлях до елемента від кореня')
  .argument('<field>', 'поле; вкладені через крапку: sizeBytes, items.0.name')
  .action((pathText, field) => {
    const node = findNode(data(), pathText);
    const result = getByPath(node, field);
    if (!result.found) {
      throw new CliError(`Поле «${field}» відсутнє в елементі «${pathText}».`);
    }
    printValue(result.value); // null — це значення, а не помилка
  });

// ---------- можливості варіанта 3 ----------
program
  .command('ls')
  .description('показати вміст теки')
  .argument('[path]', 'шлях до теки (за замовчуванням — корінь)', '')
  .option('-a, --all', 'показувати також приховані елементи')
  .action((pathText, options) => {
    const folder = findNode(data(), pathText);
    if (!isFolder(folder)) throw new CliError(`«${pathText}» не є текою.`);
    const items = childrenOf(folder).filter((child) => options.all || child.isHidden !== true);
    if (items.length === 0) {
      console.log('(порожньо)');
      return;
    }
    for (const child of items) console.log(formatLine(child, child.name));
  });

program
  .command('size')
  .description('показати сумарний розмір теки з усіма вкладеними елементами')
  .argument('[path]', 'шлях до теки (за замовчуванням — корінь)', '')
  .action((pathText) => {
    const node = findNode(data(), pathText);
    const bytes = totalSize(node);
    console.log(`${pathText || 'корінь'}: ${formatSize(bytes)} (${bytes} Б)`);
  });

program
  .command('find')
  .description('знайти файли й теки за частиною назви в усьому дереві')
  .argument('<name>', 'частина назви (без урахування регістру)')
  .addOption(
    new Option('-t, --type <type>', 'шукати лише файли або лише теки').choices(['file', 'directory']),
  )
  .action((name, options) => {
    const needle = name.toLowerCase();
    const found = [...walk(data())].filter(
      ({ node }) =>
        node.name.toLowerCase().includes(needle) && (!options.type || node.type === options.type),
    );
    if (found.length === 0) {
      console.log(`Нічого не знайдено за запитом «${name}».`);
      return;
    }
    for (const { node, path } of found) console.log(formatLine(node, path));
  });

// ---------- запуск і єдина обробка помилок ----------
try {
  program.parse();
} catch (err) {
  const text = err instanceof CliError ? err.message : `Неочікувана помилка: ${err.message}`;
  console.error(`Помилка: ${text}`);
  process.exitCode = 1;
}
