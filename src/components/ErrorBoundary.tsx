'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          margin: '20px',
          backgroundColor: '#1a0a0a',
          border: '2px solid #ff4444',
          borderRadius: '8px',
          color: '#ff6666',
          fontFamily: 'monospace',
          fontSize: '12px',
          maxHeight: '80vh',
          overflow: 'auto',
        }}>
          <h2 style={{ color: '#ff4444', margin: '0 0 10px 0' }}>⚠️ Something went wrong</h2>
          <p style={{ color: '#ffaaaa', marginBottom: '10px' }}>
            Error details (for debugging):
          </p>
          <pre style={{
            backgroundColor: '#0a0a0a',
            padding: '10px',
            borderRadius: '4px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            <strong>Error:</strong> {this.state.error?.message}
            {'\n\n'}
            <strong>Stack:</strong>
            {'\n'}
            {this.state.error?.stack}
            {this.state.errorInfo && (
              <>
                {'\n\n'}
                <strong>Component Stack:</strong>
                {'\n'}
                {this.state.errorInfo.componentStack}
              </>
            )}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '15px',
              padding: '10px 20px',
              backgroundColor: '#ff4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
