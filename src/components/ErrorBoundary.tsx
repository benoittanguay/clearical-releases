import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Error info:', errorInfo);
        this.setState({ error, errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gray-900 text-white p-8">
                    <div className="max-w-2xl mx-auto">
                        <h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1>
                        <div className="bg-gray-800 rounded-lg p-4 mb-4">
                            <h2 className="text-lg font-semibold mb-2">Error:</h2>
                            <pre className="text-red-400 text-sm overflow-auto whitespace-pre-wrap">
                                {this.state.error?.toString()}
                            </pre>
                        </div>
                        {this.state.errorInfo && (
                            <div className="bg-gray-800 rounded-lg p-4">
                                <h2 className="text-lg font-semibold mb-2">Component Stack:</h2>
                                <pre className="text-gray-400 text-xs overflow-auto whitespace-pre-wrap">
                                    {this.state.errorInfo.componentStack}
                                </pre>
                            </div>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg"
                        >
                            Reload App
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
