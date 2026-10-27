import { fileURLToPath } from 'node:url';
export const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
