import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const FALLBACK = [
  { title: 'Pure water, delivered to your door', body: { subtitle: 'Bottled at our Palamu plant. Order bottles and jars online.', cta: 'Shop water', ctaLink: '/shop' }, image: '/brand/range.webp' },
];

/**
 * Home slider driven by CMS banners (Admin → Website CMS → Home banners).
 * Auto-advances every 6 s, pauses on hover/focus/touch, swipeable, and stays still for reduced-motion users.
 */
export default function HeroSlider({ slides: input, children }) {
  const slides = input?.length ? input : FALLBACK;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const startX = useRef(null);
  const n = slides.length;
  const go = useCallback((k) => setI(((k % n) + n) % n), [n]);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (paused || reduce || n < 2) return undefined;
    const t = setTimeout(() => go(i + 1), 6000);
    return () => clearTimeout(t);
  }, [i, paused, reduce, n, go]);

  return (
    <section
      className="relative overflow-hidden bg-gradient-to-b from-white to-mist"
      aria-roledescription="carousel" aria-label="Highlights"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onPointerDown={(e) => { startX.current = e.clientX; }}
      onPointerUp={(e) => { if (startX.current == null) return; const dx = e.clientX - startX.current; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); startX.current = null; }}
    >
      <div className="flex transition-transform duration-700 ease-[cubic-bezier(.3,.7,.2,1)]" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, k) => (
          <div key={s.id || k} className="w-full shrink-0" role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} aria-hidden={k !== i}>
            <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 pb-14 pt-8 sm:pt-12 lg:grid-cols-[1.2fr_1fr] lg:gap-10 lg:pb-16 lg:pt-16">
              <div className="order-2 lg:order-1">
                {k === 0
                  ? <h1 className="water-text font-display text-[clamp(2.4rem,6.6vw,5.2rem)] font-extrabold leading-[0.95] tracking-[-0.03em]">{s.title}</h1>
                  : <h2 className="font-display text-[clamp(2.2rem,6vw,4.6rem)] font-extrabold leading-[0.97] tracking-[-0.03em] text-depth">{s.title}</h2>}
                {s.body?.subtitle && <p className="mt-5 max-w-xl text-[17px] text-ink-soft">{s.body.subtitle}</p>}
                <div className="mt-7 flex flex-wrap gap-3">
                  {s.body?.cta && <Link to={s.body.ctaLink || s.link || '/shop'} tabIndex={k === i ? 0 : -1} className="btn-primary px-6 py-3 text-[15px]">{s.body.cta}</Link>}
                  {k === 0 && <Link to="/shop/20-litre-jar" tabIndex={k === i ? 0 : -1} className="btn-outline px-6 py-3 text-[15px]">Refill a 20L jar</Link>}
                </div>
              </div>
              <div className="order-1 flex justify-center lg:order-2">
                {s.image && <img src={s.image} alt="" draggable={false} className="h-56 w-auto max-w-full select-none rounded-[22px] object-contain mix-blend-multiply sm:h-72 lg:h-[340px]" loading={k === 0 ? 'eager' : 'lazy'} />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {n > 1 && (
        <div className="absolute inset-x-0 bottom-4 mx-auto flex max-w-7xl items-center gap-3 px-4">
          <div className="flex gap-1.5">
            {slides.map((_, k) => (
              <button key={k} onClick={() => go(k)} aria-label={`Show slide ${k + 1}`} aria-current={k === i}
                className={`h-2 rounded-full transition-all ${k === i ? 'w-7 bg-aqua' : 'w-2 bg-shoal hover:bg-aqua/50'}`} />
            ))}
          </div>
          <div className="ml-auto hidden gap-2 sm:flex">
            <button className="grid size-10 place-items-center rounded-full border border-shoal bg-white text-depth hover:border-aqua" onClick={() => go(i - 1)} aria-label="Previous slide"><ChevronLeft className="size-5" /></button>
            <button className="grid size-10 place-items-center rounded-full border border-shoal bg-white text-depth hover:border-aqua" onClick={() => go(i + 1)} aria-label="Next slide"><ChevronRight className="size-5" /></button>
          </div>
        </div>
      )}
      {children}
    </section>
  );
}
