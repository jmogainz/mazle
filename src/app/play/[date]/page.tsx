import ArchivePlayClient from './play-client';

export default function PlayArchiveDatePage({ params }: { params: { date: string } }) {
  const { date } = params;
  return <ArchivePlayClient date={date} />;
}
