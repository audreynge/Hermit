"use client";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { PacketDoc } from "./Packet";

export function PacketPrint(props: { report: ShellReport; spec: RequirementSpec; runId: string }) {
  return (
    <div className="packet-print">
      <p className="no-print"><button type="button" className="btn" onClick={() => window.print()}>Print or save as PDF</button></p>
      <PacketDoc {...props} />
    </div>
  );
}
