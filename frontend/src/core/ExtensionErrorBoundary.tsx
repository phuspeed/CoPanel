import React from 'react';

interface Props {
  moduleName: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/** Isolates a failed AppStore extension — shell stays online. */
export default class ExtensionErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-lg mx-auto mt-12 rounded-xl border border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          <h2 className="text-lg font-semibold mb-2">Module failed to load</h2>
          <p className="text-sm mb-1">{this.props.moduleName}</p>
          <p className="text-xs opacity-80 font-mono break-all">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
