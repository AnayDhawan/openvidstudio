import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAllDocsMeta, getDocBySlug } from '@/lib/docs';

type DocPageProps = {
  params: Promise<{ slug: string }>;
};

// Static export needs every /docs/<slug> route enumerated at build time;
// this is the single place that turns the packages/docs/ file list into
// actual routes.
export function generateStaticParams() {
  return getAllDocsMeta().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: DocPageProps): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) return {};
  return {
    title: `${doc.meta.title} - openvidstudio docs`,
    description: doc.meta.description,
  };
}

export default async function DocPage({ params }: DocPageProps) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);
  if (!doc) notFound();

  return (
    <article className="docs-prose prose max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
    </article>
  );
}
