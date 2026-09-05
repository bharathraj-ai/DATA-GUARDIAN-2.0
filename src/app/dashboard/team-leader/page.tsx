import { redirect } from 'next/navigation';

/** Alias — team leader desk is the existing owner dashboard. */
export default function TeamLeaderAliasPage() {
  redirect('/dashboard/owner');
}
