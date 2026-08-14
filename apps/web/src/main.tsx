import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './fonts.css';
import '@carbon/styles/css/styles.css';
import './styles.css';
import './visual-system.css';
import './operations-system.css';
import './background-system.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
