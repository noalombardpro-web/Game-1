// Entry point: creates the game on the page canvas and reports fatal errors on screen.
import { Game } from './app/game.js';

function showFatal(message) {
  const box = document.getElementById('error');
  box.textContent = `Erreur : ${message}\nRechargez la page. Si le problème persiste, vérifiez la console du navigateur (WebGL 2 requis).`;
  box.classList.remove('hidden');
}

window.addEventListener('error', (event) => showFatal(event.message));
window.addEventListener('unhandledrejection', (event) => showFatal(String(event.reason?.message ?? event.reason)));

try {
  const canvas = document.getElementById('scene');
  if (!document.createElement('canvas').getContext('webgl2')) {
    throw new Error('WebGL 2 indisponible dans ce navigateur.');
  }
  new Game(canvas);
} catch (error) {
  showFatal(error.message);
}
