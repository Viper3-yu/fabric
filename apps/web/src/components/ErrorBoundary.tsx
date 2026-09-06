import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@carbon/react';
import { ArrowLeft, Renew } from '@carbon/icons-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

// Keeps a render-time crash from blanking the whole app: the visitor gets a
// recovery panel instead of a white screen.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { message: error.message || '页面渲染出现异常' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面渲染异常', error, info.componentStack);
  }

  render() {
    if (!this.state.message) return this.props.children;
    const resourceFailure = /fetch|import|module|chunk|network/i.test(this.state.message);
    return (
      <main className="not-found-page" role="alert">
        <p className="eyebrow">页面出现问题</p>
        <h1>这个页面暂时无法显示</h1>
        <p>
          {resourceFailure
            ? '页面资源未能加载，可能是本机服务暂时离线或页面版本已经更新。'
            : '页面渲染遇到异常，请重新加载后再试。'}
        </p>
        <p>本机部署请确认 WSL 服务已启动。重新加载会丢失未提交的表单内容。</p>
        <details>
          <summary>查看错误详情</summary>
          <p>{this.state.message}</p>
        </details>
        <div className="not-found-page__actions">
          <Button renderIcon={Renew} onClick={() => window.location.reload()}>
            重新加载页面
          </Button>
          <Button as="a" href="/track" kind="tertiary" renderIcon={ArrowLeft}>
            返回物流查询
          </Button>
        </div>
      </main>
    );
  }
}
