import { Logo } from '@/site/Logo';

/**
 * Hydris logo that follows the page theme: white on dark, brand blue on light.
 * Both variants render; CSS (`.only-dark` / `.only-light` in globals.css) shows the right one, so there is no hydration flash.
 */
export function ThemedLogo(props: { compact?: boolean; product?: boolean; size?: number }) {
  return (
    <>
      <span className="only-dark"><Logo {...props} tone="white" /></span>
      <span className="only-light"><Logo {...props} tone="blue" /></span>
    </>
  );
}
