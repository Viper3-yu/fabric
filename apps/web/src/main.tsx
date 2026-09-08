import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@carbon/styles/css/styles.css';
import './styles/fonts.css';
import './styles/styles.css';
import './styles/visual-system.css';
import './styles/operations-system.css';
import './styles/background-system.css';
import './styles/business-theme.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
