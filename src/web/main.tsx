import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { initDisableDevtool } from './services/disableDevtool';

// Protect devtools on live production while allowing full access in local dev
initDisableDevtool();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

