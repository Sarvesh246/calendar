// A template (unlike a layout) re-mounts on every navigation. Wrapping the page
// in `.page-shell` here means its sections replay the staggered `content-rise`
// reveal (see globals.css) each time the route changes — no JS, so it can never
// leave a page stuck mid-animation.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-shell">{children}</div>;
}
