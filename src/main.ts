import './client/style.css';
import { Game } from './client/Game';
import { Menu } from './client/Menu';
import { loadSettings } from './client/Settings';

const host = document.getElementById('app')!;
const game = new Game(host, loadSettings());
const menu = new Menu(host, game);
// deep links for tests / the website: play.html?mode=aitest&map=hangar
const q = new URLSearchParams(location.search);
if (q.get('mode')) {
  menu.mode = q.get('mode') as any;
  if (q.get('map')) menu.map = q.get('map')!;
  if (q.get('hero')) menu.hero = q.get('hero')!;
  menu.launch();
}
