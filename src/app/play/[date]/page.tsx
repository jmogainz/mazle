import ArchivePlayClient from './play-client';

export default async function PlayArchiveDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <ArchivePlayClient date={date} />;
}
