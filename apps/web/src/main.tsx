import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './styles/theme.css';

// Evita double-mount do StrictMode sobre contextos WebGL/WebGPU/WASM do RetroArch
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
