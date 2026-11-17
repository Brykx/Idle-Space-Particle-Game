import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

// A way for the browser tests to listen to the synthesiser: render a few seconds offline and
// report what came out. Behind a query parameter, so a player never loads it.
if (new URLSearchParams(location.search).has('audiotest')) {
  void import('./audio/ambience').then(({ renderSample }) => {
    (window as unknown as { __renderAmbience: typeof renderSample }).__renderAmbience = renderSample;
  });
}

export default mount(App, { target });
