/**
 * Recording Widget Entry Point
 *
 * A floating overlay that appears when audio recording is active.
 * Shows the Clearical icon, audio waveform visualization, and stop button.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingWidget } from './components/RecordingWidget';
import './widget.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <RecordingWidget />
    </StrictMode>
);
