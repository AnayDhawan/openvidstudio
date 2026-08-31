import { Hero } from '@/components/Hero';
import { TaglineReveal } from '@/components/TaglineReveal';
import { Features } from '@/components/Features';
import { Quickstart } from '@/components/Quickstart';

export default function Home() {
  return (
    <main>
      <Hero />
      <TaglineReveal />
      <Features />
      <Quickstart />
    </main>
  );
}
