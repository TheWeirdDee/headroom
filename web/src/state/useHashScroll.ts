// In-page links (/#how, /docs#models) scroll to their section after navigation; the router does not.
import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function useHashScroll(): void {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    // The target may render a moment later (data loading), so try for a short while.
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 20) {
        clearInterval(t);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
    return () => clearInterval(t);
  }, [pathname, hash]);
}
