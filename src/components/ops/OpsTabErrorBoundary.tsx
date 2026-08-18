import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/react';

interface Props {
  tabName: string;
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class OpsTabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[OpsTabErrorBoundary:${this.props.tabName}]`, error, errorInfo);
    Sentry.captureException(error, {
      tags: { surface: 'ops-console', tab: this.props.tabName },
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="space-y-4 pt-6">
          <div className="panel p-6 border border-destructive/40 bg-destructive/5 rounded-lg space-y-4 max-w-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-destructive/10 text-destructive">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-foreground">
                  {this.props.tabName} Tab Encountered an Issue
                </h3>
                <p className="text-xs text-muted-foreground">
                  The error was isolated to this tab. The rest of the Ops Console remains fully operational.
                </p>
              </div>
            </div>

            <div className="bg-background/80 border border-border/60 rounded p-3 text-xs font-mono text-destructive break-words">
              {this.state.error?.message || 'Unknown runtime error'}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="gold-bg px-4 py-2 rounded-sm text-xs font-bold flex items-center gap-1.5 transition-transform active:scale-95"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reload {this.props.tabName} Tab
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-sm text-xs font-medium border border-border"
              >
                Full Page Refresh
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
