import GameWrapper from '@/components/Game';
import Stats from '@/components/UI/Stats';
import WinModal from '@/components/UI/WinModal';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#121212] text-white select-none">
      <h1 className="text-4xl md:text-5xl font-bold mb-2 tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-blue-400 to-purple-500">
        Mazle
      </h1>
      <p className="text-gray-400 mb-8 text-sm md:text-base">Daily Gym Puzzle</p>
      
      <Stats />
      
      <div className="relative">
        <GameWrapper />
      </div>

      <div className="mt-8 text-xs text-gray-500 max-w-[400px] text-center">
        <p className="mb-2">Use Arrow Keys, WASD, or Swipe to move.</p>
        <p>Slide on ice until you hit a wall.</p>
      </div>

      <WinModal />
    </main>
  );
}
