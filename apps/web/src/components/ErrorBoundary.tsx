import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@carbon/react';
import { ArrowLeft, Renew } from '@carbon/icons-react';
import { Link } from 'react-router-dom';

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
    return (
      <main className="not-found-page" role="alert">
        <p className="eyebrow">页面出现问题</p>
        <h1>这个页面暂时无法显示</h1>
        <p>{this.state.message}</p>
        <p>可以重试当前页面，或先返回公开物流查询。</p>
        <div className="not-found-page__actions">
          <Button renderIcon={Renew} onClick={() => this.setState({ message: null })}>
            重试
          </Button>
          <Button as={Link} to="/track" kind="tertiary" renderIcon={ArrowLeft}>
            返回物流查询
          </Button>
        </div>
      </main>
    );
  }
}
