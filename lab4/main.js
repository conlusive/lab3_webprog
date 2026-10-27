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

console.log('Параметри:', options);
