import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import type { DesktopAPI } from '../../shared/schema';
declare global {interface Window {adlens: DesktopAPI}}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
