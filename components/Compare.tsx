import { compareRows } from "@/lib/chat/present";
import type { ShellReport } from "@/lib/types";

export function Compare({ reports }: { reports: ShellReport[] }) {
  const rows = compareRows(reports);
  return (
    <div className="bubble compare-wrap" style={{ padding: 12 }} tabIndex={0} aria-label="Comparison of matching spaces">
      <table className="compare">
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{reports.map((r) => <th key={r.shellId} scope="col">{r.name.split(" · ")[0]}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((v, i) => <td key={i} className="num">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
