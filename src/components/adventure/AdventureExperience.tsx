'use client';

import { useCallback, useRef, useState } from 'react';
import { ADVENTURE_CATALOG, getAdventureLevel, type AdventureLevelDefinition } from '@/adventure';
import AdventureGame, { type AdventureGameResult } from './AdventureGame';
import AdventureMap from './AdventureMap';
import { EnergySheet, LevelIntroSheet, ResultSheet } from './AdventureSheets';
import { useAdventureProgress } from './useAdventureProgress';
import styles from './AdventureExperience.module.css';

type View = 'map' | 'game' | 'result';

export default function AdventureExperience() {
  const campaign = useAdventureProgress(ADVENTURE_CATALOG);
  const beginCampaignLevel = campaign.beginLevel;
  const finishCampaignLevel = campaign.finishLevel;
  const abandonCampaignLevel = campaign.abandonLevel;
  const [view, setView] = useState<View>('map');
  const [selectedLevel, setSelectedLevel] = useState<AdventureLevelDefinition | null>(null);
  const [playingLevel, setPlayingLevel] = useState<AdventureLevelDefinition | null>(null);
  const [result, setResult] = useState<AdventureGameResult | null>(null);
  const [showEnergy, setShowEnergy] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [playSession, setPlaySession] = useState(0);

  const playLevel = useCallback(async (level: AdventureLevelDefinition) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const allowed = await beginCampaignLevel(level);
      if (!allowed) {
        setShowEnergy(true);
        return;
      }
      setSelectedLevel(null);
      setResult(null);
      setPlayingLevel(level);
      setPlaySession((session) => session + 1);
      setView('game');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [beginCampaignLevel]);

  const finishLevel = useCallback((gameResult: AdventureGameResult) => {
    if (!playingLevel) return;
    setResult(gameResult);
    setView('result');
    void finishCampaignLevel(playingLevel, gameResult);
  }, [finishCampaignLevel, playingLevel]);

  const quitLevel = useCallback((hadStarted: boolean, moves: number, timeMs: number) => {
    void abandonCampaignLevel(hadStarted ? moves : 0, timeMs);
    setPlayingLevel(null);
    setResult(null);
    setView('map');
  }, [abandonCampaignLevel]);

  const backToMap = useCallback(() => {
    setPlayingLevel(null);
    setResult(null);
    setSelectedLevel(null);
    setView('map');
  }, []);

  const replay = useCallback(() => {
    if (!playingLevel) return;
    void playLevel(playingLevel);
  }, [playLevel, playingLevel]);

  const nextLevel = useCallback(() => {
    if (!playingLevel) return;
    const next = getAdventureLevel(playingLevel.id + 1);
    if (!next) {
      backToMap();
      return;
    }
    void playLevel(next);
  }, [backToMap, playLevel, playingLevel]);

  if (!campaign.hydrated) {
    return (
      <main className={styles.loadingScreen} aria-label="Loading Mazle Adventure">
        <div className={styles.loadingMark}><span>M</span></div>
        <p>Preparing your adventure…</p>
      </main>
    );
  }

  return (
    <>
      {view === 'map' && (
        <AdventureMap
          catalog={ADVENTURE_CATALOG}
          progress={campaign.progress}
          hearts={campaign.energy.hearts}
          maxHearts={campaign.energy.maxHearts}
          refillTickets={campaign.energy.refillTickets}
          nextHeartLabel={campaign.nextHeartLabel}
          onSelectLevel={setSelectedLevel}
          onOpenEnergy={() => { campaign.clearActionError(); setShowEnergy(true); }}
        />
      )}

      {(view === 'game' || view === 'result') && playingLevel && (
        <AdventureGame
          key={`${playingLevel.id}-${playSession}`}
          level={playingLevel}
          heartAtRisk={playingLevel.id > campaign.energyPolicy.protectedThroughLevel}
          onFinish={finishLevel}
          onQuit={quitLevel}
        />
      )}

      {view === 'result' && !showEnergy && playingLevel && result && (
        <ResultSheet
          level={playingLevel}
          result={result}
          bestStars={campaign.progress[playingLevel.id]?.stars ?? 0}
          heartConsumed={playingLevel.id > campaign.energyPolicy.protectedThroughLevel}
          nextLevelAvailable={playingLevel.id < ADVENTURE_CATALOG.levels.length}
          onMap={backToMap}
          onReplay={replay}
          onNext={nextLevel}
        />
      )}

      {selectedLevel && view === 'map' && (
        <LevelIntroSheet
          level={selectedLevel}
          progress={campaign.progress[selectedLevel.id]}
          hearts={campaign.energy.hearts}
          nextHeartLabel={campaign.nextHeartLabel}
          protectedThroughLevel={campaign.energyPolicy.protectedThroughLevel}
          onClose={() => setSelectedLevel(null)}
          onPlay={() => void playLevel(selectedLevel)}
          onOpenEnergy={() => { campaign.clearActionError(); setSelectedLevel(null); setShowEnergy(true); }}
        />
      )}

      {showEnergy && (
        <EnergySheet
          hearts={campaign.energy.hearts}
          maxHearts={campaign.energy.maxHearts}
          nextHeartLabel={campaign.nextHeartLabel}
          refillTickets={campaign.energy.refillTickets}
          dailyRefillAvailable={campaign.energy.dailyRefillAvailable}
          offers={campaign.offers}
          purchasing={campaign.purchasing}
          refilling={campaign.refilling}
          error={campaign.actionError}
          onClose={() => setShowEnergy(false)}
          onUseTicket={() => void campaign.useRefill('ticket')}
          onUseDaily={() => void campaign.useRefill('daily')}
          onPurchase={(offer) => void campaign.purchaseOffer(offer)}
        />
      )}

      {campaign.syncing && view === 'map' && <div className={styles.syncPill} role="status"><span /> Syncing progress</div>}
      {starting && <div className={styles.startingOverlay} role="status"><span /> Opening level…</div>}
    </>
  );
}
