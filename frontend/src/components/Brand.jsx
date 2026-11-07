import { Link } from 'react-router-dom';

/** IBT AQUA logo (the client's own artwork). On dark grounds it sits on a white chip so the blue reads. */
export function Logo({ to = '/', light = false, className = '', size = 'md' }) {
  const h = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-14' : 'h-10';
  const img = <img src="/brand/logo-trim.webp" alt="IBT AQUA" className={`${h} w-auto`} width="116" height="88" />;
  return (
    <Link to={to} className={`inline-flex items-center ${className}`} aria-label="IBT AQUA home">
      {light ? <span className="rounded-xl bg-white px-2.5 py-1.5">{img}</span> : img}
    </Link>
  );
}

/** A thin wave used as a section edge. */
export const WaveEdge = ({ className = '', fill = '#EEF7FA' }) => (
  <svg viewBox="0 0 1440 40" preserveAspectRatio="none" className={`block h-6 w-full ${className}`} aria-hidden>
    <path d="M0 22c120-14 240-14 360 0s240 14 360 0 240-14 360 0 240 14 360 0v18H0Z" fill={fill} />
  </svg>
);
