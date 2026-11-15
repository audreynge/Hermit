"use client";
/* eslint-disable @next/next/no-img-element -- decorative sprites */
import { usePathname } from "next/navigation";

const B = "/hermit-assets/beach";

// Beach frame behind every page except home, whose hero draws the whole beach itself (aria-hidden, no pointer events).
export function Decor() {
  if (usePathname() === "/") return null;
  return (
    <div className="decor" aria-hidden="true">
      <div className="decor-water-top"><img src={`${B}/water-top.webp`} alt="" width={1600} height={213} /><span className="water-shimmer" /></div>
      <div className="decor-footer">
        <img className="decor-sand" src={`${B}/beach-footer.webp`} alt="" width={1672} height={105} />
        <img className="decor-wave wave-drift" src={`${B}/water-bottom.webp`} alt="" width={1600} height={236} />
        <img className="decor-wave-left wave-drift" src={`${B}/water-top.webp`} alt="" width={1600} height={213} />
      </div>
      <img className="decor-starfish hermit-starfish-motion" src={`${B}/starfish.webp`} alt="" width={160} height={150} />
      <img className="decor-shell hermit-starfish-motion" src={`${B}/shell-scallop.webp`} alt="" width={180} height={151} />
    </div>
  );
}
