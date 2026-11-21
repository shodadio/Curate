import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { migrateStoredStoryIds } from './storyIdMigration.ts';
import './index.css';

// Stories stored under the old, one-id-per-publication scheme are carried over before any
// screen reads them, so nothing already read can come back under its new id.
migrateStoredStoryIds();

// Without the boundary a throw anywhere in the tree unmounts everything and leaves a blank
// page — with the reader's library still stored and no way back to it.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
