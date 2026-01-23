declare module 'pulltorefreshjs' {
  interface PullToRefreshOptions {
    mainElement?: Element | string;
    triggerElement?: Element | string;
    ptrElement?: Element | string;
    classPrefix?: string;
    distThreshold?: number;
    distMax?: number;
    distReload?: number;
    shouldPullToRefresh?: () => boolean;
    resistanceFunction?: (t: number) => number;
    onRefresh?: () => Promise<void> | void;
    refreshTimeout?: number;
    getMarkup?: () => string;
    getStyles?: () => string;
    iconArrow?: string;
    iconRefreshing?: string;
    instructionsPullToRefresh?: string;
    instructionsReleaseToRefresh?: string;
    instructionsRefreshing?: string;
  }

  interface PullToRefreshInstance {
    destroy: () => void;
  }

  const PullToRefresh: {
    init: (options: PullToRefreshOptions) => PullToRefreshInstance;
    destroyAll: () => void;
  };

  export default PullToRefresh;
}
