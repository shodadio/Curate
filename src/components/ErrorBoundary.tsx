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
      <div className="min-h-screen bg-[#f6f1e7] text-[#1c1a17] flex items-center justify-center px-4 py-10 font-sans">
        <div role="alert" className="w-full max-w-md rounded-3xl border border-[#c9bc9f] bg-[#efe8d6] p-6 space-y-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <CuratorMark className="w-10 h-10" />
            <div className="min-w-0">
              <h1 className="font-serif text-lg font-semibold tracking-tight text-[#1c1a17]">Curator hit a problem</h1>
              <p className="text-xs text-[#6f675c] mt-1">The page stopped loading, but your library was not deleted.</p>
            </div>
          </div>

          <p className="text-sm text-[#3f3a33] leading-relaxed">
            Your sources, saved articles and reading history live in this browser. Reload to pick up
            where you left off, or export a copy first if you want to be certain.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1c1a17] px-4 text-sm font-semibold text-[#f6f1e7] transition hover:bg-[#3a352d]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload</span>
            </button>
            <button
              type="button"
              onClick={this.handleExport}
              className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c9bc9f] bg-transparent px-4 text-sm font-medium text-[#1c1a17] transition hover:border-[#1c1a17]"
            >
              <Download className="w-4 h-4" />
              <span>Export my data</span>
            </button>
          </div>

          {this.state.exportNote && (
            <p role="status" className="text-xs text-[#6f675c] leading-relaxed">{this.state.exportNote}</p>
          )}

          <details className="text-xs text-[#6f675c]">
            <summary className="cursor-pointer font-medium text-[#1c1a17]">Technical details</summary>
            <p className="mt-2 font-mono text-xs leading-relaxed break-words text-[#6f675c]">
              {this.state.error.message || String(this.state.error)}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[#6f675c]">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Reloading usually clears this; repeated crashes are worth reporting.</span>
            </p>
          </details>
        </div>
      </div>
    );
  }
}
