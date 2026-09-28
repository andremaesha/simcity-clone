import './style.css';
import { Game } from './game';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const game = new Game(canvas, uiRoot);
game.start();

if (import.meta.env.DEV) {
  (window as unknown as { game: Game }).game = game;
}
