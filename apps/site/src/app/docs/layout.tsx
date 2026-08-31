import { getAllDocsMeta } from '@/lib/docs';
import { DocsSidebar } from './DocsSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const docs = getAllDocsMeta();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 md:flex-row">
      <DocsSidebar docs={docs} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
