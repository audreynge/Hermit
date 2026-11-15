// From hermit-ui-assets: the results skeleton. Styles live in hermit-components.css (imported once in app/layout.tsx);
// the page's beach decor now comes from pack_two sprites in components/Decor.tsx and components/Hero.tsx.
export function PropertySkeleton({ count = 2 }: { count?: number }) {
  return <div className="hermit-skeleton-grid" aria-label="Loading property results" aria-busy="true">
    {Array.from({length: Math.min(6, Math.max(1,count))}, (_, i) => <div className="hermit-skeleton-card" key={i}>
      <div className="hermit-shimmer hermit-skeleton-photo" />
      <div className="hermit-skeleton-content"><div className="hermit-shimmer hermit-skeleton-line" style={{width:'72%'}}/><div className="hermit-shimmer hermit-skeleton-line" style={{width:'92%'}}/><div className="hermit-shimmer hermit-skeleton-line" style={{width:'55%'}}/></div>
    </div>)}
    <span className="sr-only">Properties loading</span>
  </div>;
}
