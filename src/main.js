import { bootKakiRally } from './app/rallyApp.js';

try {
  await bootKakiRally();
} catch (error) {
  document.body.dataset.kakiRallyReady = 'false';
  console.error('[Kaki Rally] boot failed', error);
}
