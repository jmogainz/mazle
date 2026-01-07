'use client';

import { MapType, GenerationProgress, GeneratorBackend, isRustBackendConfigured } from '@/game';
import { PuzzleData } from '@/game';
import styles from '../app/page.module.css';

interface DevToolsProps {
  puzzle: PuzzleData;
  puzzleNumber: number;
  puzzleLabel: string | null;
  activeSeed: string;
  seedInput: string;
  onSeedInputChange: (value: string) => void;
  selectedMapType: MapType | 'random';
  onMapTypeChange: (type: MapType | 'random') => void;
  startBatchInput: string;
  onStartBatchInputChange: (value: string) => void;
  selectedBackend: GeneratorBackend;
  onBackendChange: (backend: GeneratorBackend) => void;
  lastUsedBackend: 'rust-backend' | 'wasm' | null;
  hintsEnabled: boolean;
  onHintsToggle: (enabled: boolean) => void;
  maxLives: number;
  onMaxLivesChange: (count: number) => void;
  isGenerating: boolean;
  generationProgress: GenerationProgress | null;
  onGenerate: (seed?: string) => void;
  onLoadDaily: () => void;
  onStopGeneration: () => void;
  previewFeaturesEnabled: boolean;
  onPreviewFeaturesToggle: (enabled: boolean) => void;
  onClose: () => void;
  canStopGeneration: boolean;
  closenessThreshold: number;
  onClosenessThresholdChange: (value: number) => void;
  isProd?: boolean;
}

export default function DevTools({
  puzzle,
  puzzleNumber,
  puzzleLabel,
  activeSeed,
  seedInput,
  onSeedInputChange,
  selectedMapType,
  onMapTypeChange,
  startBatchInput,
  onStartBatchInputChange,
  selectedBackend,
  onBackendChange,
  lastUsedBackend,
  hintsEnabled,
  onHintsToggle,
  maxLives,
  onMaxLivesChange,
  isGenerating,
  generationProgress,
  onGenerate,
  onLoadDaily,
  onStopGeneration,
  previewFeaturesEnabled,
  onPreviewFeaturesToggle,
  onClose,
  canStopGeneration,
  closenessThreshold,
  onClosenessThresholdChange,
  isProd = false,
}: DevToolsProps) {
  const progressPercent = generationProgress
    ? Math.round((generationProgress.workersComplete / generationProgress.totalWorkers) * 100)
    : 0;

  return (
    <div
      className={styles.devOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Dev Tools"
    >
      <div className={styles.devPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.devPanelHeader}>
          <span className={styles.devPanelTitle}>🛠 Dev Tools</span>
          <button
            className={styles.devCloseButton}
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Seed Info */}
        <div className={styles.devSeedInfo}>
          <span className={styles.devSeedLabel}>
            {puzzleLabel ?? `Daily #${puzzleNumber}`}
          </span>
          <span className={styles.devSeedValue}>{activeSeed || 'daily'}</span>
        </div>

        <div className={styles.devToggleRow}>
          <label className={styles.devToggleLabel}>
            <input
              className={styles.devToggleInput}
              type="checkbox"
              checked={hintsEnabled}
              onChange={(e) => onHintsToggle(e.target.checked)}
            />
            Hints
          </label>
          <span className={styles.devToggleHint}>Show hint overlays after life loss</span>
        </div>

        <div className={styles.devToggleRow}>
          <label className={styles.devToggleLabel}>
            Lives: {maxLives}
          </label>
          <input
            type="range"
            min="3"
            max="5"
            value={maxLives}
            onChange={(e) => onMaxLivesChange(parseInt(e.target.value, 10))}
            className={styles.devRangeInput}
            disabled={isGenerating}
          />
        </div>

        <div className={styles.devToggleRow}>
          <label className={styles.devToggleLabel}>
            Threshold %: {closenessThreshold.toFixed(3)}
          </label>
          <input
            type="range"
            min="0.900"
            max="1.000"
            step="0.001"
            value={closenessThreshold}
            onChange={(e) => onClosenessThresholdChange(parseFloat(e.target.value))}
            className={styles.devRangeInput}
            disabled={isGenerating}
          />
        </div>

        <div className={styles.devToggleRow}>
          <label className={styles.devToggleLabel}>
            <input
              className={styles.devToggleInput}
              type="checkbox"
              checked={previewFeaturesEnabled}
              onChange={(e) => onPreviewFeaturesToggle(e.target.checked)}
            />
            Preview Features
          </label>
          <span className={styles.devToggleHint}>Show Archive/Leaderboard buttons in prod.</span>
        </div>

        {/* Core Stats - 3x2 grid */}
        <div className={styles.devStatsGrid6}>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue} style={{ textTransform: 'uppercase' }}>
              {puzzle.mapType ?? 'ice'}
            </span>
            <span className={styles.devStatLabel}>Map</span>
          </div>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue}>{puzzle.width}×{puzzle.height}</span>
            <span className={styles.devStatLabel}>Size</span>
          </div>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue}>{puzzle.optimalMoves}</span>
            <span className={styles.devStatLabel}>Moves</span>
          </div>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue}>{puzzle.difficultyScore ?? '—'}</span>
            <span className={styles.devStatLabel}>Score</span>
          </div>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue}>{puzzle.selectedBatch ?? '—'}</span>
            <span className={styles.devStatLabel}>Batch</span>
          </div>
          <div className={styles.devStatItem}>
            <span className={styles.devStatValue}>{puzzle.nearOptimalPaths ?? '—'}</span>
            <span className={styles.devStatLabel}>Paths</span>
          </div>
        </div>

        {/* Key Metrics - 2x2 grid */}
        <div className={styles.devMetricsSection}>
          <div className={styles.devMetricsHeader}>
            <span className={styles.devMetricsTitle}>Key Metrics</span>
          </div>
          <div className={styles.devMetricsGrid2x2}>
            <div className={styles.devMetricItemPrimary}>
              <span className={styles.devMetricValue}>
                {puzzle.pathOverlap != null ? puzzle.pathOverlap.toFixed(2) : '—'}
              </span>
              <span className={styles.devMetricLabel}>Overlap Min</span>
            </div>
            <div className={styles.devMetricItemPrimary}>
              <span className={styles.devMetricValue}>
                {puzzle.pathOverlapAvg != null ? puzzle.pathOverlapAvg.toFixed(2) : '—'}
              </span>
              <span className={styles.devMetricLabel}>Overlap Avg</span>
            </div>
            <div className={styles.devMetricItemPrimary}>
              <span className={styles.devMetricValue}>
                {puzzle.earlyDivergence != null ? puzzle.earlyDivergence.toFixed(2) : '—'}
              </span>
              <span className={styles.devMetricLabel}>Early Div</span>
            </div>
            <div className={styles.devMetricItemPrimary}>
              <span className={styles.devMetricValue}>
                {puzzle.pathLocality != null ? puzzle.pathLocality.toFixed(2) : '—'}
              </span>
              <span className={styles.devMetricLabel}>Locality</span>
            </div>
          </div>
        </div>

        {/* Secondary Metrics - 2 column */}
        <div className={styles.devMetricsSection}>
          <div className={styles.devMetricsHeader}>
            <span className={styles.devMetricsTitle}>Per-Move</span>
          </div>
          <div className={styles.devMetricsGrid2}>
            <div className={styles.devMetricItemSecondary}>
              <span className={styles.devMetricValue}>{puzzle.directionChanges ?? '—'}</span>
              <span className={styles.devMetricLabel}>Dir Changes</span>
            </div>
            <div className={styles.devMetricItemSecondary}>
              <span className={styles.devMetricValue}>
                {puzzle.decisionAmbiguity != null ? puzzle.decisionAmbiguity.toFixed(1) : '—'}
              </span>
              <span className={styles.devMetricLabel}>Ambiguity</span>
            </div>
          </div>
        </div>

        {/* Legacy Metrics (Collapsed) */}
        <details className={styles.devMetricsCollapsible}>
          <summary className={styles.devMetricsSummary}>
            <span className={styles.devMetricsTitle}>Legacy Metrics</span>
          </summary>
          <div className={styles.devMetricsGrid3}>
            <div className={styles.devMetricItemTertiary}>
              <span className={styles.devMetricValue}>{puzzle.counterIntuitiveMoves ?? '—'}</span>
              <span className={styles.devMetricLabel}>CI</span>
            </div>
            <div className={styles.devMetricItemTertiary}>
              <span className={styles.devMetricValue}>{puzzle.attractiveDecoys ?? '—'}</span>
              <span className={styles.devMetricLabel}>Decoys</span>
            </div>
            <div className={styles.devMetricItemTertiary}>
              <span className={styles.devMetricValue}>{puzzle.commitmentGates ?? '—'}</span>
              <span className={styles.devMetricLabel}>Gates</span>
            </div>
            <div className={styles.devMetricItemTertiary}>
              <span className={styles.devMetricValue}>{puzzle.falseProgressPaths ?? '—'}</span>
              <span className={styles.devMetricLabel}>False Prog</span>
            </div>
            <div className={styles.devMetricItemTertiary}>
              <span className={styles.devMetricValue}>{puzzle.backtrackDepth ?? '—'}</span>
              <span className={styles.devMetricLabel}>Backtrack</span>
            </div>
          </div>
        </details>

        {/* Maze Engine Selector */}
        <div className={styles.devBackendSection}>
          <div className={styles.devBackendHeader}>
            Maze Engine
            {lastUsedBackend && (
              <span className={styles.devBackendStatus}>
                {lastUsedBackend === 'rust-backend' ? '🦀 Rust' : 'WASM'}
              </span>
            )}
          </div>
          <div className={styles.devBackendOptions}>
            <label className={styles.devBackendOption}>
              <input
                type="radio"
                name="engine"
                value="auto"
                checked={selectedBackend === 'auto'}
                onChange={() => onBackendChange('auto')}
                disabled={isGenerating}
              />
              <span>Auto</span>
            </label>
            <label
              className={`${styles.devBackendOption} ${!isRustBackendConfigured() ? styles.devBackendDisabled : ''}`}
              title={isRustBackendConfigured() ? 'Rust server (fastest, parallel)' : 'Not configured (set NEXT_PUBLIC_GENERATOR_URL)'}
            >
              <input
                type="radio"
                name="engine"
                value="rust"
                checked={selectedBackend === 'rust'}
                onChange={() => onBackendChange('rust')}
                disabled={isGenerating || !isRustBackendConfigured()}
              />
              <span>🦀 Rust</span>
            </label>
            <label
              className={styles.devBackendOption}
              title="Browser WASM (parallel via Web Workers)"
            >
              <input
                type="radio"
                name="engine"
                value="wasm"
                checked={selectedBackend === 'wasm'}
                onChange={() => onBackendChange('wasm')}
                disabled={isGenerating}
              />
              <span>WASM</span>
            </label>
          </div>
        </div>

        {/* Controls */}
        <div className={styles.devControls}>
          {!isProd && (
            <>
              <input
                value={seedInput}
                onChange={(e) => onSeedInputChange(e.target.value)}
                placeholder="Custom seed or YYYY-MM-DD"
                className={styles.devInput}
                disabled={isGenerating}
              />
              <div className={styles.devInputRow}>
                <select
                  value={selectedMapType}
                  onChange={(e) => onMapTypeChange(e.target.value as MapType | 'random')}
                  className={styles.devSelect}
                  disabled={isGenerating}
                >
                  <option value="random">Random Map</option>
                  <option value={MapType.ICE}>Ice Map</option>
                  <option value={MapType.GROUND}>Ground Map</option>
                </select>
                <input
                  value={startBatchInput}
                  onChange={(e) => onStartBatchInputChange(e.target.value.replace(/\D/g, ''))}
                  placeholder="Start batch #"
                  className={styles.devInputSmall}
                  disabled={isGenerating}
                  title="Start generation at a specific batch number (deterministic)"
                />
              </div>
            </>
          )}
          <div className={styles.devButtonRow}>
            {!isProd && (
              <>
                <button
                  type="button"
                  className={styles.devButton}
                  onClick={() => onGenerate(seedInput)}
                  disabled={isGenerating}
                >
                  Load
                </button>
                <button
                  type="button"
                  className={styles.devButtonSecondary}
                  onClick={() => onGenerate()}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <span className={styles.buttonSpinner} />
                  ) : (
                    '🎲 Random'
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              className={styles.devButtonGhost}
              onClick={onLoadDaily}
              disabled={isGenerating}
            >
              ↩ Daily
            </button>
          </div>
        </div>

        {/* Generation Progress */}
        {isGenerating && generationProgress && (
          <div className={styles.devProgress}>
            <div className={styles.devProgressHeader}>
              {generationProgress.phase === 'rust-backend'
                ? `🦀 Generating... ${progressPercent}%`
                : `⚡ Generating... ${progressPercent}%`}
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className={styles.devProgressActions}>
              <button
                type="button"
                className={styles.devButtonDanger}
                onClick={onStopGeneration}
                disabled={!canStopGeneration}
              >
                ⏹ Stop
              </button>
            </div>
          </div>
        )}

        <p className={styles.devHint}>Dev runs are not saved to stats</p>
      </div>
    </div>
  );
}
