"use client";
import { useEffect } from "react";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { PacketDoc } from "./Packet";

export function PacketPrint(props: { report: ShellReport; spec: RequirementSpec; runId: string }) {
  // ?print=1 (from "Download PDF") opens the print dialog once the browser-stored profile has rendered.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("print") !== "1") return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="packet-print">
      <p className="no-print"><button type="button" className="btn" onClick={() => window.print()}>Save as PDF or print</button></p>
      <PacketDoc {...props} />
    </div>
  );
}
