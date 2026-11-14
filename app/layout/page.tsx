import { redirect } from "next/navigation";

export default function LayoutRedirect() {
  redirect("/?design=draw");
}
