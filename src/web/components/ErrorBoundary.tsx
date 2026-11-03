import { Component, type ErrorInfo, type ReactNode } from "react";

/** A render crash shows what happened instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; info: string }> {
  override state = { error: null as Error | null, info: "" };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? "" });
    console.error(error);
  }

  override render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ""}\n${info}`;
    return (
      <div className="no-repo" role="alert" style={{ height: "100vh" }}>
        <h1>Something went wrong</h1>
        <p className="hint">The interface hit an unexpected error. Your Lore servers are not affected.</p>
        <pre className="license-text" style={{ maxHeight: 300 }}>{details}</pre>
        <div className="row">
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(details)}>
            Copy details
          </button>
          <button className="btn" onClick={() => this.setState({ error: null, info: "" })}>
            Try to continue
          </button>
        </div>
      </div>
    );
  }
}
