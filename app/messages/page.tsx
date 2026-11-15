import { MessagesInbox } from "@/components/Inboxes";

export const metadata = { title: "Messages · Hermit" };
export default function MessagesPage() {
  return <div><header className="page-intro"><h1>Messages</h1><p>Hermit drafts every message from what it couldn&apos;t confirm. You review and send it yourself.</p></header><MessagesInbox /></div>;
}
