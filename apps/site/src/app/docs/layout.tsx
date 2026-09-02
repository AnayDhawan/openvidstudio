import { getAllDocsMeta } from '@/lib/docs';
import { DocsSidebar } from './DocsSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const docs = getAllDocsMeta();

  return (
    // Visual chrome only, task 4: texture-docs.png as a sparse, low-opacity
    // background behind the whole /docs section (index + every [slug] page
    // share this layout). Fixed positioning so it doesn't scroll with the
    // long markdown content, and the data read in getAllDocsMeta() above is
    // untouched.
    <div className="relative">
      <img
        src="/brand/texture-docs.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 h-full w-full object-cover opacity-[0.06]"
      />
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-16 md:flex-row">
        <DocsSidebar docs={docs} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
