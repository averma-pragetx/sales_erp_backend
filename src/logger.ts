type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
// ponytail: LOG_LEVEL env gate instead of a config file — one knob, default 'info'
// hides debug noise in prod, `LOG_LEVEL=debug npm run dev` turns it on locally.
const MIN_LEVEL = Math.max(0, LEVELS.indexOf((process.env.LOG_LEVEL as Level) || 'info'));

const COLOR: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function make(level: Level) {
  const idx = LEVELS.indexOf(level);
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  return (...args: unknown[]) => {
    if (idx < MIN_LEVEL) return;
    method(`${COLOR[level]}${new Date().toISOString()} ${level.toUpperCase()}${RESET}`, ...args);
  };
}

export const logger = {
  debug: make('debug'),
  info:  make('info'),
  warn:  make('warn'),
  error: make('error'),
};
