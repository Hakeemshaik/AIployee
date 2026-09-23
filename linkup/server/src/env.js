import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings live in the project root .env (next to docker-compose.yml).
dotenv.config({ path: path.join(SERVER_DIR, '..', '.env'), quiet: true });
