import type { CSSProperties } from 'react';
import './tokens.css';
import './animations.css';

// assetBase defaults to /hermit-assets, matching the README installation instructions.
export function CoastalTop({ assetBase = '/hermit-assets' }: { assetBase?: string }) {
  return <div className="hermit-coastal-strip" aria-hidden="true"><img src={`${assetBase}/shoreline-top.svg`} alt="" /><div className="hermit-water-motion" /></div>;
}
export function CoastalBottom({ assetBase = '/hermit-assets' }: { assetBase?: string }) {
  return <div className="hermit-footer-shore" aria-hidden="true"><img src={`${assetBase}/shoreline-bottom.svg`} alt="" /></div>;
}
export function HeroCoast({ assetBase = '/hermit-assets' }: { assetBase?: string }) {
  return <div className="hermit-hero-coast"><img src={`${assetBase}/hero-coast.svg`} alt="Minimal illustration of a quiet shoreline with a hermit crab" /></div>;
}
export function CrabLoader({ label = 'Finding matching spaces', progress, assetBase = '/hermit-assets' }: { label?: string; progress?: number; assetBase?: string }) {
  const validProgress = progress == null ? undefined : Math.min(100, Math.max(0, progress));
  return <div className="hermit-crab-loader" role="status" aria-label={label}>
    <img className="hermit-crab-motion" src={`${assetBase}/crab-mascot.svg`} width="68" height="60" alt="" />
    <strong>{label}<span className="hermit-loading-dots" aria-hidden="true"><span /><span /><span /></span></strong>
    <div className="hermit-progress-track" aria-hidden="true"><div className="hermit-progress-fill" style={{ width: validProgress == null ? '42%' : `${validProgress}%` }} /></div>
    {validProgress != null && <span className="hermit-loader-percentage">{Math.round(validProgress)}%</span>}
  </div>;
}
export function PropertySkeleton({ count = 2 }: { count?: number }) {
  return <div className="hermit-skeleton-grid" aria-label="Loading property results" aria-busy="true">
    {Array.from({length: Math.min(6, Math.max(1,count))}, (_, i) => <div className="hermit-skeleton-card" key={i}>
      <div className="hermit-shimmer hermit-skeleton-photo" />
      <div className="hermit-skeleton-content"><div className="hermit-shimmer hermit-skeleton-line" style={{width:'72%'}}/><div className="hermit-shimmer hermit-skeleton-line" style={{width:'92%'}}/><div className="hermit-shimmer hermit-skeleton-line" style={{width:'55%'}}/></div>
    </div>)}
    <span className="sr-only">Properties loading</span>
  </div>;
}
export function StarfishAccent({ assetBase = '/hermit-assets', style }: { assetBase?: string; style?: CSSProperties }) {
  return <img className="hermit-starfish-motion" src={`${assetBase}/starfish.svg`} width="38" height="38" style={style} alt="" aria-hidden="true" />;
}
