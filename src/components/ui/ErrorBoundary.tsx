import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "页面运行异常" };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>页面加载失败</h1>
          <p>请重新加载页面。如果仍然失败，请将下面的错误信息反馈给维护者。</p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: 12,
            }}
          >
            {this.state.error}
          </pre>
          <button
            className="button primary"
            onClick={() => {
              const next = new URL(location.href);
              next.searchParams.set("v", String(Date.now()));
              location.replace(next.href);
            }}
          >
            重新加载页面
          </button>
        </div>
      </div>
    );
  }
}
