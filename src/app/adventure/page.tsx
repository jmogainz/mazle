import type { Metadata } from 'next';
import AdventureExperience from '@/components/adventure/AdventureExperience';

export const metadata: Metadata = {
  title: 'Adventure',
  description: 'Climb the Frostpeak Trail through 50 Mazle puzzles. Find the perfect route and collect every star.',
  alternates: { canonical: '/adventure' },
};

export default function AdventurePage() {
  return <AdventureExperience />;
}
