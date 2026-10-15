/**
 * Theme constants + the blocking inline script that sets `data-theme` on <html> before first paint.
 * Plain module (no 'use client') so the server root layout can import the script string as a value.
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'hydris.theme';
/** Mode used when the visitor has never chosen one. Dark is the Hydris default surface. */
export const THEME_DEFAULT_MODE: ThemeMode = 'dark';
/** Browser chrome colour (meta theme-color) per resolved theme — matches --color-bg. */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#081116', light: '#f6f8fc' };
/** Routes that always render dark (the glasses viewport is a dark HUD by design). */
export const FORCED_DARK_RE = /^\/glasses(\/|$)/;

export const themeInitScript = `(function(){try{var d=document.documentElement,m=null;try{m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}
if(m!=="light"&&m!=="dark"&&m!=="system")m=${JSON.stringify(THEME_DEFAULT_MODE)};
var f=${FORCED_DARK_RE.toString()}.test(location.pathname);
var r=f?"dark":m==="system"?(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):m;
d.setAttribute("data-theme",r);d.setAttribute("data-theme-mode",f?"dark":m);
var c=r==="light"?${JSON.stringify(THEME_COLORS.light)}:${JSON.stringify(THEME_COLORS.dark)};
var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",c)}catch(e){}})();`;
