import { writeFileSync } from 'node:fs';
import { phrases } from '../lib/config.js';
writeFileSync(new URL('./phrases.json', import.meta.url), JSON.stringify(phrases, null, 2) + '\n');
