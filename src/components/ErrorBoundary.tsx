import React from 'react';
import { AlertCircle, Download, RefreshCw } from 'lucide-react';
import { CuratorMark } from './CuratorLogo';
import { downloadAppData } from '../storage';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  exportNote: string | null;
}

/**
 * The last line of defence: without this, any throw during render or in a commit-phase
 * effect unmounts the tree and leaves a permanently blank page — with the reading library
 * still sitting in localStorage and no way to reach it.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, exportNote: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Curator] Unhandled render error', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleExport = () => {
    const downloaded = downloadAppData();
    this.setState({
      exportNote: downloaded
        ? 'Downloaded a copy of everything Curator has stored in this browser.'
        : 'This browser would not let Curator read its storage. Try Reload first.',
    });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10 font-sans">
        <div role="alert" className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-slate-900 p-6 space-y-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <CuratorMark className="w-10 h-10" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">Curator hit a problem</h1>
              <p className="text-xs text-slate-400 mt-1">The page stopped loading, but your library was not deleted.</p>
            </div>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">
            Your sources, saved articles and reading history live in this browser. Reload to pick up
            where you left off, or export a copy first if you want to be certain.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload</span>
            </button>
            <button
              type="button"
              onClick={this.handleExport}
              className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm font-medium text-slate-200 transition hover:border-amber-500/40 hover:text-amber-300"
            >
              <Download className="w-4 h-4" />
              <span>Export my data</span>
            </button>
          </div>

          {this.state.exportNote && (
            <p role="status" className="text-xs text-amber-200/90 leading-relaxed">{this.state.exportNote}</p>
          )}

          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer font-medium text-slate-300">Technical details</summary>
            <p className="mt-2 font-mono text-xs leading-relaxed break-words text-slate-400">
              {this.state.error.message || String(this.state.error)}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-slate-400">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Reloading usually clears this; repeated crashes are worth reporting.</span>
            </p>
          </details>
        </div>
      </div>
    );
  }
}
