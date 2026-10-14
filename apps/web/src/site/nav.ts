export const SITE_NAV = [
  { href: '/product', label: 'Product' },
  { href: '/operations', label: 'Wastewater operations' },
  { href: '/technology', label: 'Technology' },
  { href: '/demo', label: 'Demo' },
  { href: '/contact', label: 'Contact' },
] as const;

export const isActive = (pathname: string | null, href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
