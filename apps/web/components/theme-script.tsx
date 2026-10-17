/**
 * Applies the stored (or system) colour scheme before hydration to avoid a
 * flash of the wrong theme.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('xstore-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
